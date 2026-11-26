import asyncio
import importlib
import os
import sys
import unittest
from unittest.mock import patch


os.environ.setdefault("BOT_TOKEN", "123456:test-token")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tikwahm-bot"))
bot = importlib.import_module("bot")


class TikipRotationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.proxies = [
            {"id": "proxy-one", "host": "one.example", "port": 1, "username": "u", "password": "p"},
            {"id": "proxy-two", "host": "two.example", "port": 2, "username": "u", "password": "p"},
            {"id": "proxy-three", "host": "three.example", "port": 3, "username": "u", "password": "p"},
        ]
        bot._PROXY_POOL = [dict(proxy) for proxy in self.proxies]
        bot._ACTIVE_PROXY_INDEX = 0
        bot._PROXY_LOCK = asyncio.Lock()
        bot._BROWSER_SEMAPHORE = asyncio.Semaphore(1)

    async def test_attempt_timeout_rotates_without_waiting_for_background_timeout(self):
        calls = []

        async def fetch_once(_username, proxy, _progress=None):
            calls.append(proxy["id"])
            if proxy["id"] == "proxy-one":
                await asyncio.sleep(1)
            return {"proxy": proxy["id"]}

        with patch.object(bot, "SOURCE_ATTEMPT_TIMEOUT_SECONDS", 0.01), patch.object(
            bot, "_fetch_once_through_proxy", side_effect=fetch_once
        ):
            result = await bot.fetch_data_from_tikip("alice")

        self.assertEqual(result, {"proxy": "proxy-two"})
        self.assertEqual(calls, ["proxy-one", "proxy-two"])

    async def test_one_lookup_never_reuses_proxy_after_retry(self):
        calls = []

        async def fetch_once(_username, proxy, _progress=None):
            calls.append(proxy["id"])
            if len(calls) < 3:
                raise bot._ProxyConnectionBroken()
            return "ok"

        with patch.object(bot, "_fetch_once_through_proxy", side_effect=fetch_once):
            result = await bot.fetch_data_from_tikip("alice")

        self.assertEqual(result, "ok")
        self.assertEqual(calls, ["proxy-one", "proxy-two", "proxy-three"])
        self.assertEqual(len(calls), len(set(calls)))

    async def test_rotation_wraps_for_later_lookups_without_resetting(self):
        calls = []

        async def fetch_once(_username, proxy, _progress=None):
            calls.append(proxy["id"])
            return proxy["id"]

        with patch.object(bot, "_fetch_once_through_proxy", side_effect=fetch_once):
            results = [
                await bot.fetch_data_from_tikip(username)
                for username in ("one", "two", "three", "four")
            ]

        self.assertEqual(results, ["proxy-one", "proxy-two", "proxy-three", "proxy-one"])
        self.assertEqual(calls, results)
        self.assertEqual(bot._ACTIVE_PROXY_INDEX, 1)

    async def test_concurrent_lookups_reserve_distinct_slots_at_the_index(self):
        calls = []
        first_started = asyncio.Event()
        release_first = asyncio.Event()

        async def fetch_once(username, proxy, _progress=None):
            calls.append((username, proxy["id"]))
            if username == "alice":
                first_started.set()
                await release_first.wait()
            return proxy["id"]

        with patch.object(bot, "_fetch_once_through_proxy", side_effect=fetch_once):
            first = asyncio.create_task(bot.fetch_data_from_tikip("alice"))
            await first_started.wait()
            second = asyncio.create_task(bot.fetch_data_from_tikip("bob"))
            await asyncio.sleep(0)
            release_first.set()
            results = await asyncio.gather(first, second)

        self.assertEqual(results, ["proxy-one", "proxy-two"])
        self.assertEqual({proxy_id for _, proxy_id in calls}, {"proxy-one", "proxy-two"})

    async def test_provider_restriction_is_not_retried(self):
        calls = []

        async def fetch_once(_username, proxy, _progress=None):
            calls.append(proxy["id"])
            return bot._PROVIDER_RESTRICTION_MESSAGE

        with patch.object(bot, "_fetch_once_through_proxy", side_effect=fetch_once):
            result = await bot.fetch_data_from_tikip("alice")

        self.assertEqual(result, bot._PROVIDER_RESTRICTION_MESSAGE)
        self.assertEqual(calls, ["proxy-one"])


if __name__ == "__main__":
    unittest.main()
