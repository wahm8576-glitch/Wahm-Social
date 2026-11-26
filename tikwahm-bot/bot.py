#!/usr/bin/env python3
"""نسخة محدثة لبوت TikWahm مع تدوير تلقائي للبروكسي بعد كل محاولة."""
import asyncio
import base64
import hashlib
import hmac
import html
import json
import os
import re
import shutil
import time
from urllib.parse import quote, urlparse
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
import uvicorn

from telebot import asyncio_helper, types
from telebot.async_telebot import AsyncTeleBot
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

BOT_TOKEN = os.environ.get("BOT_TOKEN", "").strip()
if not BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN environment variable is required")

bot = AsyncTeleBot(BOT_TOKEN)
WEBHOOK_SECRET = ""
WEBHOOK_SECRET_SEED = os.environ.get("WEBHOOK_SECRET", "").strip()
WEBHOOK_PATH = "/telegram/webhook"
TIKIP_URL = "https://tikip.us/"
MAX_LOOKUP_SECONDS = 15
EXPECTED_LOOKUP_SECONDS = 10
CACHE_TTL_SECONDS = 10 * 60
SOURCE_TIMEOUT_MILLISECONDS = CACHE_TTL_SECONDS * 1_000
PROGRESS_ANIMATION_INTERVAL = 1.0
LOADING_GIF_PATH = os.path.join(os.path.dirname(__file__), "tikwahm_loading.gif")
PROGRESS_MEDIA_ID = "tikwahm_loading"
PROGRESS_ATTACHMENT_NAME = "loading_animation"
_LOOKUP_CACHE = {}
_LOOKUP_TASKS = {}
_RETRY_IN_PROGRESS = set()
_BROWSER_SEMAPHORE = asyncio.Semaphore(1)

FIELD_LABELS = {
    "ESTIMATED CURRENT REGION": "country",
    "JOINED": "joined",
    "LANGUAGE": "language",
    "USER ID": "user_id",
    "NICKNAME UPDATED": "nickname_updated",
    "USERNAME UPDATED": "username_updated",
    "FOLLOWERS": "followers",
    "HEARTS": "hearts",
    "VIDEOS": "videos",
    "FOLLOWING": "following",
    "FRIENDS": "friends",
    "HEARTS PER FOLLOWER": "hearts_per_follower",
    "EST. ENGAGEMENT": "engagement",
}

FIELD_NAMES_AR = {
    "country": "الدولة الحالية",
    "joined": "تاريخ الانضمام",
    "language": "اللغة",
    "user_id": "معرّف الحساب",
    "nickname_updated": "آخر تحديث للاسم",
    "username_updated": "آخر تحديث لاسم المستخدم",
    "followers": "المتابعون",
    "hearts": "الإعجابات",
    "videos": "الفيديوهات",
    "following": "يتابع",
    "friends": "الأصدقاء",
    "hearts_per_follower": "الإعجابات لكل متابع",
    "engagement": "معدل التفاعل التقديري",
}

COUNTRIES_AR = {
    "italy": "إيطاليا",
    "saudi arabia": "المملكة العربية السعودية",
    "united states": "الولايات المتحدة",
    "united kingdom": "المملكة المتحدة",
    "united arab emirates": "الإمارات العربية المتحدة",
    "egypt": "مصر",
    "kuwait": "الكويت",
    "qatar": "قطر",
    "bahrain": "البحرين",
    "oman": "عُمان",
    "jordan": "الأردن",
    "iraq": "العراق",
    "turkey": "تركيا",
    "france": "فرنسا",
    "germany": "ألمانيا",
    "canada": "كندا",
    "australia": "أستراليا",
}

COUNTRY_FLAGS = {
    "italy": "🇮🇹",
    "saudi arabia": "🇸🇦",
    "united states": "🇺🇸",
    "united kingdom": "🇬🇧",
    "united arab emirates": "🇦🇪",
    "egypt": "🇪🇬",
    "kuwait": "🇰🇼",
    "qatar": "🇶🇦",
    "bahrain": "🇧🇭",
    "oman": "🇴🇲",
    "jordan": "🇯🇴",
    "iraq": "🇮🇶",
    "turkey": "🇹🇷",
    "france": "🇫🇷",
    "germany": "🇩🇪",
    "canada": "🇨🇦",
    "australia": "🇦🇺",
}

LANGUAGES_AR = {
    "ar": "العربية",
    "en": "الإنجليزية",
    "it": "الإيطالية",
    "fr": "الفرنسية",
    "tr": "التركية",
    "es": "الإسبانية",
    "de": "الألمانية",
    "ja": "اليابانية",
    "ko": "الكورية",
    "zh": "الصينية",
}

MONTHS_AR = {
    1: "يناير", 2: "فبراير", 3: "مارس", 4: "أبريل",
    5: "مايو", 6: "يونيو", 7: "يوليو", 8: "أغسطس",
    9: "سبتمبر", 10: "أكتوبر", 11: "نوفمبر", 12: "ديسمبر",
}


def normalize_username(text: str):
    text = (text or "").strip()
    match = re.search(
        r"(?:https?://)?(?:www\.)?tiktok\.com/@([A-Za-z0-9._]{1,24})",
        text,
        re.IGNORECASE,
    )
    username = match.group(1) if match else text.lstrip("@").strip()
    if re.fullmatch(r"[A-Za-z0-9._]{1,24}", username):
        return username
    return None


def _format_date(value: str) -> str:
    """حوّل التواريخ الشائعة في بطاقة المصدر إلى صيغة عربية مقروءة."""
    value = value.strip()
    match = re.fullmatch(
        r"(\d{1,2})/(\d{1,2})/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM))?",
        value,
        re.IGNORECASE,
    )
    if not match:
        return value
    month, day, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
    if month not in MONTHS_AR:
        return value
    formatted = f"{day} {MONTHS_AR[month]} {year}"
    if match.group(4):
        hour = int(match.group(4))
        minute = match.group(5)
        period = "صباحًا" if match.group(6).upper() == "AM" else "مساءً"
        formatted += f"، {hour:02d}:{minute} {period}"
    return formatted


def _translate_value(field: str, value: str) -> str:
    value = value.strip()
    if field == "country":
        country_name = COUNTRIES_AR.get(value.casefold(), value)
        flag = COUNTRY_FLAGS.get(value.casefold(), "")
        return f"{country_name} {flag}" if flag else country_name
    if field == "language":
        return LANGUAGES_AR.get(value.casefold(), value)
    if field in {"joined", "nickname_updated", "username_updated"}:
        if value.casefold() in {"never", "n/a", "not available"}:
            return "لم يسبق تغييره" if field != "joined" else value
        return _format_date(value)
    return value


def _parse_result(username: str, raw_text: str):
    lines = [line.strip() for line in (raw_text or "").splitlines()]
    lines = [line for line in lines if line]
    key_lines = {label.casefold(): key for label, key in FIELD_LABELS.items()}
    first_field_index = len(lines)
    fields = {}
    i = 0
    while i < len(lines):
        current = lines[i].strip()
        upper = current.upper().strip(" :")
        matched_label = None
        matched_value = ""
        for label in FIELD_LABELS:
            if upper == label:
                matched_label = label
                break
            prefix = label + ":"
            if current.upper().startswith(prefix):
                matched_label = label
                matched_value = current[len(prefix):].strip()
                break
        if matched_label:
            first_field_index = min(first_field_index, i)
            field = key_lines[matched_label.casefold()]
            if not matched_value:
                j = i + 1
                while j < len(lines) and lines[j].upper() in {"ENGAGEMENT", "PROFILE"}:
                    j += 1
                if j < len(lines) and lines[j].strip().casefold() not in key_lines:
                    matched_value = lines[j]
                    i = j
            if matched_value:
                fields[field] = _translate_value(field, matched_value)
        i += 1

    header = lines[:first_field_index]
    display_name = ""
    bio_parts = []
    saw_username = False
    for line in header:
        if line.startswith("@"):
            saw_username = True
            continue
        if not display_name:
            candidate = re.sub(r"^[♯#]+\s*", "", line).strip()
            if candidate and candidate.upper() not in {"ENGAGEMENT", "PROFILE"}:
                display_name = candidate
            continue
        if saw_username and line.upper() not in {"ENGAGEMENT", "PROFILE"}:
            bio_parts.append(line)

    display_name = display_name or f"@{username}"
    return display_name, " ".join(bio_parts), fields


def format_tikip_result(username: str, raw_text: str) -> str:
    """حوّل نص بطاقة Tikip الخام إلى بطاقة عربية واضحة مع إبقاء الحقول المتاحة."""
    if not (raw_text or "").strip():
        return f"لم تظهر بيانات واضحة للحساب @{username}. جرّب مرة أخرى لاحقًا."

    display_name, bio, fields = _parse_result(username, raw_text)
    output = ["📊 إحصاءات حساب TikTok", "━━━━━━━━━━━━━━━━━━"]
    output.append(f"👤 الاسم: {display_name}")
    output.append(f"🔗 اسم المستخدم: @{username}")
    if bio:
        output.append("📝 النبذة: " + bio)

    profile_fields = [
        "country", "joined", "language", "user_id", "nickname_updated", "username_updated"
    ]
    profile_values = [key for key in profile_fields if fields.get(key)]
    stats_fields = [
        "followers", "hearts", "videos", "following", "friends",
        "hearts_per_follower", "engagement",
    ]
    stats_values = [key for key in stats_fields if fields.get(key) is not None]
    if profile_values or stats_values:
        first_section = "🌐 معلومات الحساب" if profile_values else "📈 الإحصاءات"
        output.extend(["", first_section, "", "البيان | القيمة"])
    if profile_values:
        for field in profile_values:
            source_note = " (بحسب المصدر)" if field == "country" else ""
            output.append(f"{FIELD_NAMES_AR[field]} | {fields[field]}{source_note}")

    if stats_values:
        if profile_values:
            output.extend(["", "📈 الإحصاءات"])
        for field in stats_values:
            output.append(f"{FIELD_NAMES_AR[field]} | {fields[field]}")

    if not profile_values and not stats_values:
        output.extend(["", raw_text.strip()])

    result = "\n".join(output)
    if len(result) > 3_500:
        result = result[:3_450].rstrip() + "\n… تم اختصار بقية النص."
    return result


def _escape_markdown(value: str) -> str:
    value = str(value).replace("\n", " ").replace("\r", " ")
    return re.sub(r"([\\`*_{}\[\]()#+\-.!|>~])", r"\\\1", value)


def format_tikip_rich_markdown(username: str, plain_text: str, avatar_url: str = "") -> str:
    """كوّن Rich Message بصيغة Markdown الموثقة رسميًا في Telegram Bot API."""
    lines = (plain_text or "").splitlines()
    display_name = next(
        (line.removeprefix("👤 الاسم: ").strip() for line in lines if line.startswith("👤 الاسم: ")),
        f"@{username}",
    )
    bio = next(
        (line.removeprefix("📝 النبذة: ").strip() for line in lines if line.startswith("📝 النبذة: ")),
        "",
    )
    sections = {"🌐 معلومات الحساب": [], "📈 الإحصاءات": []}
    active_section = None
    for line in lines:
        if line in sections:
            active_section = line
        elif line.startswith("📈 الإحصاءات"):
            active_section = "📈 الإحصاءات"
        elif line.startswith("🌐 معلومات الحساب"):
            active_section = "🌐 معلومات الحساب"
        elif active_section and (line.startswith("• ") or " | " in line):
            item = line[2:] if line.startswith("• ") else line
            if item.strip().casefold() == "البيان | القيمة":
                continue
            if " | " in item:
                label, value = item.split(" | ", 1)
                sections[active_section].append((label.strip(), value.strip()))
            elif ":" in item:
                label, value = item.split(":", 1)
                sections[active_section].append((label.strip(), value.strip()))

    followers = next(
        (value for label, value in sections["📈 الإحصاءات"] if label == FIELD_NAMES_AR["followers"]),
        "",
    )
    hearts = next(
        (value for label, value in sections["📈 الإحصاءات"] if label == FIELD_NAMES_AR["hearts"]),
        "",
    )

    chunks = ["## 📊 إحصاءات حساب TikTok"]
    parsed_avatar = urlparse(avatar_url or "")
    safe_avatar = (
        avatar_url
        if parsed_avatar.scheme == "https" and parsed_avatar.hostname
        and parsed_avatar.hostname not in {"localhost", "127.0.0.1"}
        else ""
    )
    if safe_avatar:
        photo_caption = []
        if followers:
            photo_caption.append(f"👥 {followers} متابعًا")
        if hearts:
            photo_caption.append(f"❤️ {hearts} إعجاب")
        caption = " · ".join(photo_caption) or f"صورة الحساب @{username}"
        image_url = quote(safe_avatar, safe=":/?&=%@,+-_.~")
        chunks.append(f'![صورة الحساب]({image_url} "{caption}")')

    chunks.append(f"**{_escape_markdown(display_name)}** · `@{username}`")
    if followers and not safe_avatar:
        chunks.append(f"👥 **المتابعون:** {followers}")
    if bio:
        chunks.append(f"📝 {_escape_markdown(bio)}")

    has_rows = any(sections.values())
    if has_rows:
        chunks.append("### تفاصيل الحساب والإحصاءات")
        table_rows = ["| البيان | القيمة |", "| --- | --- |"]
        for title, rows in sections.items():
            if not rows:
                continue
            table_rows.append(f"| **{_escape_markdown(title)}** |  |")
            for label, value in rows:
                table_rows.append(
                    f"| {_escape_markdown(label)} | {_escape_markdown(value)} |"
                )
        chunks.append("\n".join(table_rows))

    if not has_rows:
        chunks.append(_escape_markdown(plain_text))
    return "\n\n".join(chunks)


def _set_progress(progress, stage):
    if progress is not None:
        progress["stage"] = stage


# Proxy credentials live in a separate file; never log or print its contents.
PROXY_LIST_PATH = os.environ.get(
    "TIKWAHM_PROXY_LIST_FILE",
    os.path.join(os.path.dirname(__file__), "proxy_pool.txt"),
).strip()


def _load_proxy_pool(path: str):
    """Read Webshare entries in host:port:username:password format."""
    proxies = []
    try:
        with open(path, "r", encoding="utf-8") as proxy_file:
            for raw_line in proxy_file:
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split(":", 3)
                if len(parts) != 4:
                    continue
                host, port, username, password = parts
                if not host or not port.isdigit() or not username or not password:
                    continue
                port_number = int(port)
                if not 1 <= port_number <= 65535:
                    continue
                proxies.append({
                    "host": host,
                    "port": port_number,
                    "username": username,
                    "password": password,
                })
    except OSError:
        return []
    return proxies


_PROXY_POOL = _load_proxy_pool(PROXY_LIST_PATH)
_ACTIVE_PROXY_INDEX = 0
_PROXY_LOCK = asyncio.Lock()

_CONNECTION_FAILURE_MARKERS = (
    "err_proxy_connection_failed",
    "err_tunnel_connection_failed",
    "err_connection_closed",
    "err_connection_reset",
    "err_connection_refused",
    "err_connection_timed_out",
    "err_timed_out",
    "err_name_not_resolved",
    "err_name_resolution_failed",
    "err_socks_connection_failed",
    "err_internet_disconnected",
    "err_network_changed",
    "err_address_unreachable",
    "econnreset",
    "econnrefused",
    "ehostunreach",
    "enetunreach",
    "network is unreachable",
    "connection reset",
    "connection refused",
    "connection timed out",
)
_PROVIDER_DENIAL_MARKERS = (
    "captcha",
    "i'm not a robot",
    "i am not a robot",
    "verify you are human",
    "verify that you are human",
    "checking your browser",
    "checking if the site connection is secure",
    "access denied",
    "unauthorized",
    "not authorized",
    "you do not have access",
    "you don't have access",
    "access restricted",
    "too many requests",
    "forbidden",
    "request blocked",
    "unusual traffic",
    "automated requests",
    "security check",
    "security challenge",
    "robot check",
    "cloudflare",
)
_PROVIDER_RESTRICTION_MESSAGE = (
    "المصدر أبلغ عن حظر أو تحقق أمني أو رفض وصول في هذه المحاولة. "
    "تم تبديل البروكسي للمحاولة القادمة؛ جرّب إعادة المحاولة."
)


class _ProxyConnectionBroken(Exception):
    """Raised only for an explicit transport/proxy connection failure."""


def _is_connection_failure(error_or_text) -> bool:
    text = str(error_or_text or "").casefold()
    return any(marker in text for marker in _CONNECTION_FAILURE_MARKERS)


def _proxy_launch_config(proxy):
    return {
        "server": f"http://{proxy['host']}:{proxy['port']}",
        "username": proxy["username"],
        "password": proxy["password"],
    }


async def _get_next_proxy():
    """سحب البروكسي الحالي وتقديم المؤشر للبروكسي التالي تلقائياً لكل محاولة."""
    global _ACTIVE_PROXY_INDEX
    async with _PROXY_LOCK:
        total = len(_PROXY_POOL)
        if total == 0:
            return None, -1
        current_index = _ACTIVE_PROXY_INDEX % total
        _ACTIVE_PROXY_INDEX = (current_index + 1) % total
        return _PROXY_POOL[current_index], current_index


async def _page_shows_provider_restriction(page, denied_statuses) -> bool:
    if any(status in {401, 403, 429} for status in denied_statuses):
        return True
    try:
        challenge = page.locator(
            'iframe[src*="captcha" i], iframe[src*="challenge" i], '
            '[class*="captcha" i], [id*="captcha" i]'
        )
        for index in range(min(await challenge.count(), 5)):
            if await challenge.nth(index).is_visible():
                return True
    except Exception:
        pass
    try:
        body = (await page.locator("body").inner_text(timeout=2500)).casefold()
    except Exception:
        body = ""
    return any(marker in body for marker in _PROVIDER_DENIAL_MARKERS)


async def _fetch_once_through_proxy(username: str, proxy, progress=None):
    """Perform one lookup through one proxy."""
    browser = None
    source_host = (urlparse(TIKIP_URL).hostname or "").casefold()
    denied_statuses = []
    connection_failures = []
    try:
        _set_progress(progress, "تهيئة البحث")
        async with async_playwright() as p:
            options = {"headless": True, "proxy": _proxy_launch_config(proxy)}
            executable = (
                os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
                or shutil.which("chromium")
                or shutil.which("chromium-browser")
                or shutil.which("google-chrome")
            )
            if executable:
                options["executable_path"] = executable
            if os.name == "posix":
                options["args"] = ["--no-sandbox"]

            browser = await p.chromium.launch(**options)
            _set_progress(progress, "فتح مصدر البيانات")
            page = await browser.new_page()

            def record_response(response):
                try:
                    response_host = (urlparse(response.url).hostname or "").casefold()
                    if response_host == source_host and response.status in {401, 403, 429}:
                        denied_statuses.append(response.status)
                except Exception:
                    pass

            def record_failed_request(request):
                try:
                    request_host = (urlparse(request.url).hostname or "").casefold()
                    relevant_type = request.resource_type in {"document", "xhr", "fetch"}
                    if (request_host == source_host and relevant_type
                            and _is_connection_failure(request.failure or "")):
                        connection_failures.append(True)
                except Exception:
                    pass

            page.on("response", record_response)
            page.on("requestfailed", record_failed_request)

            try:
                await page.goto(
                    TIKIP_URL,
                    wait_until="domcontentloaded",
                    timeout=SOURCE_TIMEOUT_MILLISECONDS,
                )
            except Exception as exc:
                if denied_statuses or await _page_shows_provider_restriction(page, denied_statuses):
                    return _PROVIDER_RESTRICTION_MESSAGE
                if _is_connection_failure(exc) or connection_failures:
                    raise _ProxyConnectionBroken from exc
                raise

            if await _page_shows_provider_restriction(page, denied_statuses):
                return _PROVIDER_RESTRICTION_MESSAGE

            search_box = page.locator("#username-input")
            try:
                await search_box.wait_for(state="visible", timeout=SOURCE_TIMEOUT_MILLISECONDS)
                await search_box.fill(username)
                await page.locator("#search-button").click(timeout=SOURCE_TIMEOUT_MILLISECONDS)
            except Exception as exc:
                if denied_statuses or await _page_shows_provider_restriction(page, denied_statuses):
                    return _PROVIDER_RESTRICTION_MESSAGE
                if _is_connection_failure(exc) or connection_failures:
                    raise _ProxyConnectionBroken from exc
                raise
            _set_progress(progress, "البحث عن الحساب وجمع بياناته")

            try:
                await page.wait_for_function(
                    """() => {
                        const visible = (el) => el && !el.classList.contains('hidden')
                            && getComputedStyle(el).display !== 'none';
                        return visible(document.querySelector('#results-card'))
                            || visible(document.querySelector('#message-area'));
                    }""",
                    timeout=SOURCE_TIMEOUT_MILLISECONDS,
                )
            except PlaywrightTimeoutError:
                if await _page_shows_provider_restriction(page, denied_statuses):
                    return _PROVIDER_RESTRICTION_MESSAGE
                if connection_failures:
                    raise _ProxyConnectionBroken
                return (
                    f"انتهت مهلة البحث ولم يعرض الموقع نتيجة خلال "
                    f"{_arabic_digits(MAX_LOOKUP_SECONDS)} ثوانٍ. "
                    "جرّب مرة أخرى لاحقًا أو تحقق من أن الموقع متاح."
                )

            if await _page_shows_provider_restriction(page, denied_statuses):
                return _PROVIDER_RESTRICTION_MESSAGE

            _set_progress(progress, "وصلت البيانات؛ جارٍ تنسيق النتيجة")
            result_card = page.locator("#results-card")
            if not await result_card.is_visible():
                text = (await page.locator("#message-area").inner_text()).strip()
                if not text and connection_failures:
                    raise _ProxyConnectionBroken
                return text or "لم يعرض الموقع نتيجة واضحة. جرّب اسم مستخدم آخر."

            text = (await result_card.inner_text()).strip()
            if not text:
                return "ظهر رد من الموقع لكنه لم يتضمن نصًا واضحًا. جرّب اسم مستخدم آخر."
            plain_text = format_tikip_result(username, text)
            avatar_url = await page.locator("#avatar").get_attribute("src")
            parsed_avatar = urlparse(avatar_url or "")
            if parsed_avatar.scheme != "https" or not parsed_avatar.hostname:
                avatar_url = ""
            rich_markdown = format_tikip_rich_markdown(username, plain_text, avatar_url or "")
            return {"text": plain_text, "markdown": rich_markdown, "avatar_url": avatar_url or ""}
    finally:
        if browser is not None:
            try:
                await browser.close()
            except Exception:
                pass


async def fetch_data_from_tikip(username: str, progress=None):
    """يتم تغيير البروكسي تلقائياً مع كل محاولة بحث جديدة، وعند فشل الاتصال يتم الانتقال للتالي فوراً."""
    if not _PROXY_POOL:
        return (
            "لا يمكن إجراء البحث: ملف إعداد البروكسي غير متاح أو لا يحتوي إدخالات صالحة. "
            "لم يتم الاتصال مباشرة."
        )

    total_proxies = len(_PROXY_POOL)
    for _ in range(total_proxies):
        proxy, proxy_index = await _get_next_proxy()
        if proxy is None:
            break
        print(f"Using proxy slot #{proxy_index + 1}/{total_proxies} for @{username}", flush=True)
        try:
            async with _BROWSER_SEMAPHORE:
                result = await _fetch_once_through_proxy(username, proxy, progress)
            return result
        except _ProxyConnectionBroken:
            # في حال فشل الاتصال بالبروكسي، تستمر الحلقة وتجرب البروكسي التالي تلقائياً
            print(f"Proxy slot #{proxy_index + 1} connection failed, rotating to next...", flush=True)
            continue
        except PlaywrightTimeoutError:
            return "انتهت مهلة تحميل صفحة البحث. تم تبديل البروكسي، حاول مرة أخرى."
        except Exception as exc:
            return (
                "تعذر إكمال البحث بسبب مشكلة في المتصفح أو الموقع "
                f"({type(exc).__name__}). تم تبديل البروكسي، حاول مرة أخرى."
            )

    return (
        "تعذر الاتصال عبر جميع البروكسيات المتاحة في القائمة بسبب أعطال اتصال."
    )


def _arabic_digits(value) -> str:
    return str(value).translate(str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩"))


def _progress_message(username: str, percent: int, headline: str = "") -> str:
    percent = max(0, min(100, int(percent)))
    filled = percent // 10
    bar = "🟦" * filled + "⬜" * (10 - filled)
    title = headline or f"🔎 جارٍ البحث عن @{username}"
    return f"{title}\n\n{bar} {_arabic_digits(percent)}٪"


def _progress_rich_message(text: str, media_source: str) -> types.InputRichMessage:
    """Build a Rich Message with an auto-playing animation and its progress text."""
    caption = "<br>".join(html.escape(line) for line in str(text).splitlines())
    if not caption:
        caption = "&nbsp;"
    return types.InputRichMessage(
        html=(
            f'<figure><video src="tg://video?id={PROGRESS_MEDIA_ID}"></video>'
            f"<figcaption>{caption}</figcaption></figure>"
        ),
        media=[
            types.InputRichMessageMedia(
                id=PROGRESS_MEDIA_ID,
                media=types.InputMediaAnimation(media=media_source),
            )
        ],
        is_rtl=True,
    )


def _progress_animation_file_id(wait_msg) -> str:
    animation = getattr(wait_msg, "animation", None)
    file_id = getattr(animation, "file_id", None)
    if file_id:
        return file_id
    rich_message = getattr(wait_msg, "rich_message", None)
    for block in getattr(rich_message, "blocks", None) or []:
        file_id = getattr(getattr(block, "animation", None), "file_id", None)
        if file_id:
            return file_id
    return ""


async def _send_rich_progress_message(message, text: str):
    """Upload the GIF as an attached rich-message animation (no public host needed)."""
    with open(LOADING_GIF_PATH, "rb") as animation:
        rich_message = _progress_rich_message(
            text, f"attach://{PROGRESS_ATTACHMENT_NAME}"
        )
        result = await asyncio_helper._process_request(
            bot.token,
            "sendRichMessage",
            method="post",
            params={
                "chat_id": str(message.chat.id),
                "rich_message": rich_message.to_json(),
                "reply_parameters": types.ReplyParameters(
                    message_id=message.message_id
                ).to_json(),
            },
            files={
                PROGRESS_ATTACHMENT_NAME: (
                    os.path.basename(LOADING_GIF_PATH),
                    animation,
                )
            },
        )
    return types.Message.de_json(result)


def _retry_markup(username: str):
    markup = types.InlineKeyboardMarkup()
    markup.add(
        types.InlineKeyboardButton(
            "إعادة المحاولة مجددًا",
            callback_data=f"retry:{username}",
        )
    )
    return markup


def _prune_lookup_cache():
    now = time.monotonic()
    expired = [key for key, (expires_at, _) in _LOOKUP_CACHE.items() if expires_at <= now]
    for key in expired:
        _LOOKUP_CACHE.pop(key, None)


async def _lookup_and_cache(username: str):
    key = username.casefold()
    current_task = asyncio.current_task()
    try:
        try:
            result = await asyncio.wait_for(
                fetch_data_from_tikip(username), timeout=CACHE_TTL_SECONDS
            )
        except asyncio.TimeoutError:
            result = "نعتذر، لم تكتمل عملية البحث. اضغط إعادة المحاولة مجددًا."
        except Exception as exc:
            result = f"تعذر إكمال الطلب ({type(exc).__name__}). حاول مرة أخرى لاحقًا."
        _LOOKUP_CACHE[key] = (time.monotonic() + CACHE_TTL_SECONDS, result)
        return result
    finally:
        if _LOOKUP_TASKS.get(key) is current_task:
            _LOOKUP_TASKS.pop(key, None)


def _get_or_start_lookup(username: str, force_fresh: bool = False):
    _prune_lookup_cache()
    key = username.casefold()
    if force_fresh:
        _LOOKUP_CACHE.pop(key, None)
    cached = _LOOKUP_CACHE.get(key)
    if cached:
        return cached[1], None, True
    task = _LOOKUP_TASKS.get(key)
    if task is None:
        task = asyncio.create_task(_lookup_and_cache(username))
        _LOOKUP_TASKS[key] = task
    return None, task, False


async def _send_wait_message(message, username: str):
    caption = _progress_message(username, 0)
    try:
        wait_msg = await _send_rich_progress_message(message, caption)
        if not _progress_animation_file_id(wait_msg):
            try:
                await bot.delete_message(message.chat.id, wait_msg.message_id)
            except Exception:
                pass
            raise RuntimeError("Rich progress message did not return an animation file_id")
        return wait_msg, "rich"
    except Exception as exc:
        print(f"Rich progress fallback: {type(exc).__name__}", flush=True)

    try:
        with open(LOADING_GIF_PATH, "rb") as animation:
            wait_msg = await bot.send_animation(
                chat_id=message.chat.id,
                animation=animation,
                caption=caption,
                reply_to_message_id=message.message_id,
            )
        return wait_msg, "animation"
    except Exception as exc:
        print(f"Animation progress fallback: {type(exc).__name__}", flush=True)
        wait_msg = await bot.reply_to(message, caption)
        return wait_msg, "text"


async def _edit_wait_message(chat_id, wait_msg, is_animation: bool, text: str, reply_markup=None):
    if is_animation == "rich":
        file_id = _progress_animation_file_id(wait_msg)
        if not file_id:
            raise RuntimeError("Progress animation file_id is unavailable")
        return await bot.edit_message_text(
            chat_id=chat_id,
            message_id=wait_msg.message_id,
            rich_message=_progress_rich_message(text, file_id),
            reply_markup=reply_markup,
        )
    if is_animation == "animation":
        return await bot.edit_message_caption(
            chat_id=chat_id,
            message_id=wait_msg.message_id,
            caption=text,
            reply_markup=reply_markup,
        )
    if is_animation:
        return await bot.edit_message_caption(
            chat_id=chat_id,
            message_id=wait_msg.message_id,
            caption=text,
            reply_markup=reply_markup,
        )
    return await bot.edit_message_text(
        chat_id=chat_id,
        message_id=wait_msg.message_id,
        text=text,
        reply_markup=reply_markup,
    )


async def _deliver_result(chat_id, wait_msg, is_animation: bool, result):
    if isinstance(result, dict) and result.get("markdown"):
        try:
            await bot.delete_message(chat_id, wait_msg.message_id)
        except Exception:
            pass
        try:
            rich_message = types.InputRichMessage(markdown=result["markdown"], is_rtl=True)
            await bot.send_rich_message(chat_id=chat_id, rich_message=rich_message)
            return
        except Exception as exc:
            print(f"Rich result fallback: {type(exc).__name__}", flush=True)
            result = result.get("text", "تعذر تنسيق النتيجة. حاول مرة أخرى.")

    text = str(result)
    if is_animation:
        try:
            await bot.delete_message(chat_id, wait_msg.message_id)
        except Exception:
            pass
        await bot.send_message(chat_id=chat_id, text=text)
        return
    try:
        await bot.edit_message_text(
            chat_id=chat_id,
            message_id=wait_msg.message_id,
            text=text,
        )
    except Exception:
        await bot.send_message(chat_id=chat_id, text=text)


async def _show_timeout(wait_msg, chat_id, username: str, is_animation: bool):
    text = (
        "نعتذر، تأخرت النتيجة. حفظنا البحث مؤقتًا لمدة ١٠ دقائق؛ "
        "اضغط لإعادة المحاولة."
    )
    try:
        await _edit_wait_message(
            chat_id,
            wait_msg,
            is_animation,
            text,
            reply_markup=_retry_markup(username),
        )
    except Exception:
        await bot.send_message(
            chat_id=chat_id,
            text=text,
            reply_markup=_retry_markup(username),
        )


async def _wait_for_visible_result(username, wait_msg, chat_id, is_animation, task):
    started = time.monotonic()
    while True:
        if task.done():
            try:
                result = task.result()
            except Exception as exc:
                result = f"تعذر إكمال الطلب ({type(exc).__name__}). حاول مرة أخرى لاحقًا."
            await _deliver_result(chat_id, wait_msg, is_animation, result)
            return True

        elapsed = time.monotonic() - started
        if elapsed >= MAX_LOOKUP_SECONDS:
            final_delay_message = _progress_message(
                username,
                100,
                "⚠️ حصل بعض التأخير، ثانية من فضلك",
            )
            try:
                await _edit_wait_message(
                    chat_id, wait_msg, is_animation, final_delay_message
                )
                await asyncio.sleep(0.2)
            except Exception:
                pass
            await _show_timeout(wait_msg, chat_id, username, is_animation)
            return False

        if elapsed < EXPECTED_LOOKUP_SECONDS:
            percent = int(elapsed / EXPECTED_LOOKUP_SECONDS * 100)
            text = _progress_message(username, percent)
        elif elapsed < EXPECTED_LOOKUP_SECONDS + PROGRESS_ANIMATION_INTERVAL:
            text = _progress_message(username, 100)
        else:
            delay_elapsed = elapsed - EXPECTED_LOOKUP_SECONDS
            percent = int(delay_elapsed / (MAX_LOOKUP_SECONDS - EXPECTED_LOOKUP_SECONDS) * 100)
            text = _progress_message(
                username,
                percent,
                "⚠️ حصل بعض التأخير، ثانية من فضلك",
            )
        try:
            await _edit_wait_message(chat_id, wait_msg, is_animation, text)
        except Exception:
            pass
        remaining = MAX_LOOKUP_SECONDS - elapsed
        await asyncio.wait({task}, timeout=min(PROGRESS_ANIMATION_INTERVAL, remaining))


async def _show_cached_progress(chat_id, wait_msg, username: str, is_animation: bool, result):
    try:
        await bot.edit_message_reply_markup(
            chat_id=chat_id,
            message_id=wait_msg.message_id,
            reply_markup=None,
        )
    except Exception:
        pass
    for percent in (20, 40, 60, 80, 100):
        try:
            await _edit_wait_message(
                chat_id,
                wait_msg,
                is_animation,
                _progress_message(username, percent, "🔄 جارٍ استرجاع النتيجة"),
            )
        except Exception:
            pass
        await asyncio.sleep(0.5)
    await _deliver_result(chat_id, wait_msg, is_animation, result)


async def _retry_active_lookup(chat_id, wait_msg, username: str, is_animation: bool, task):
    try:
        await bot.edit_message_reply_markup(
            chat_id=chat_id,
            message_id=wait_msg.message_id,
            reply_markup=None,
        )
    except Exception:
        pass
    for percent in (20, 40, 60, 80, 100):
        if task.done():
            break
        try:
            await _edit_wait_message(
                chat_id,
                wait_msg,
                is_animation,
                _progress_message(username, percent, "🔄 جارٍ استرجاع النتيجة"),
            )
        except Exception:
            pass
        await asyncio.wait({task}, timeout=0.5)
    if task.done():
        try:
            result = task.result()
        except Exception as exc:
            result = f"تعذر إكمال الطلب ({type(exc).__name__}). حاول مرة أخرى لاحقًا."
        await _deliver_result(chat_id, wait_msg, is_animation, result)
        return
    await _show_timeout(wait_msg, chat_id, username, is_animation)


@bot.message_handler(commands=["start", "help"])
async def send_welcome(message):
    await bot.reply_to(
        message,
        "أرسل اسم مستخدم TikTok عام مثل @username أو رابط الملف، "
        "وسأبحث عن معلومات الحساب وإحصاءاته.",
    )


@bot.message_handler(func=lambda message: True)
async def handle_username_message(message):
    raw_text = getattr(message, "text", None) or ""
    username = normalize_username(raw_text)
    if not username:
        await bot.reply_to(
            message,
            "أرسل اسم مستخدم TikTok صالحًا (من 1 إلى 24 حرفًا: أحرف أو أرقام أو نقطة أو شرطة سفلية).",
        )
        return

    wait_msg, is_animation = await _send_wait_message(message, username)
    cached_result, task, is_cached = _get_or_start_lookup(username)
    if is_cached:
        await _show_cached_progress(
            message.chat.id, wait_msg, username, is_animation, cached_result
        )
        return
    await _wait_for_visible_result(
        username, wait_msg, message.chat.id, is_animation, task
    )


@bot.callback_query_handler(func=lambda call: bool(call.data and call.data.startswith("retry:")))
async def retry_lookup_callback(call):
    username = normalize_username((call.data or "").removeprefix("retry:"))
    if not username:
        await bot.answer_callback_query(call.id, text="تعذر قراءة اسم المستخدم.")
        return

    message = call.message
    chat_id = message.chat.id
    retry_key = f"{chat_id}:{username.casefold()}"
    if retry_key in _RETRY_IN_PROGRESS:
        await bot.answer_callback_query(call.id, text="جارٍ استرجاع النتيجة الآن.")
        return

    _RETRY_IN_PROGRESS.add(retry_key)
    try:
        await bot.answer_callback_query(call.id)
        if _progress_animation_file_id(message):
            is_animation = "rich" if getattr(message, "rich_message", None) else "animation"
        else:
            is_animation = False
        # إذا كان هناك بحث نشط حالياً نتابعه، وإلا نبدأ بحثاً جديداً ببروكسي جديد
        cached_result, task, is_cached = _get_or_start_lookup(username)
        if is_cached and isinstance(cached_result, str):
            # إذا كانت النتيجة المخزنة مجرد رسالة خطأ، نلغي الكاش لنعيد المحاولة ببروكسي جديد
            cached_result, task, is_cached = _get_or_start_lookup(username, force_fresh=True)

        if is_cached:
            await _show_cached_progress(
                chat_id, message, username, is_animation, cached_result
            )
        elif task:
            await _retry_active_lookup(
                chat_id, message, username, is_animation, task
            )
    finally:
        _RETRY_IN_PROGRESS.discard(retry_key)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global WEBHOOK_SECRET
    public_url = os.environ.get("RENDER_EXTERNAL_URL", "").rstrip("/")
    if not public_url:
        raise RuntimeError("RENDER_EXTERNAL_URL is required to configure Telegram webhook")

    secret_seed = WEBHOOK_SECRET_SEED or BOT_TOKEN
    secret_payload = f"tikwahm-webhook:{public_url}".encode("utf-8")
    digest = hmac.new(secret_seed.encode("utf-8"), secret_payload, hashlib.sha256).digest()
    WEBHOOK_SECRET = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")

    webhook_url = f"{public_url}{WEBHOOK_PATH}"
    webhook_set = await bot.set_webhook(
        url=webhook_url,
        secret_token=WEBHOOK_SECRET,
        allowed_updates=["message", "callback_query"],
    )
    if not webhook_set:
        raise RuntimeError("Telegram did not accept the webhook configuration")
    print("TikWahm webhook configured.", flush=True)
    yield


app = FastAPI(title="TikWahm Test Bot", lifespan=lifespan)


@app.get("/", response_class=HTMLResponse)
async def home_page():
    return """<!doctype html>
<html lang="ar" dir="rtl">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>TikWahm</title>
    <style>body{font:16px system-ui;background:#101827;color:#e7edf7;display:grid;place-items:center;min-height:90vh;margin:0}main{max-width:36rem;padding:2rem;border:1px solid #34415a;border-radius:1rem;background:#182338}h1{margin-top:0;color:#60d6c4}p{line-height:1.8;color:#c3cede}code{color:#9cb6ff}</style>
  </head>
  <body><main><h1>خدمة TikWahm تعمل</h1>
    <p>هذه صفحة حالة الخدمة. يستقبل البوت تحديثات تيليجرام عبر webhook.</p>
    <p>فحص الصحة: <code>/health</code></p>
  </main></body>
</html>"""


@app.get("/health")
async def health_check():
    return {"ok": True, "service": "tikwahm", "mode": "webhook"}


@app.post(WEBHOOK_PATH)
async def telegram_webhook(request: Request):
    supplied_secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    if not WEBHOOK_SECRET or not hmac.compare_digest(supplied_secret, WEBHOOK_SECRET):
        raise HTTPException(status_code=403, detail="Invalid webhook secret")

    try:
        update = types.Update.de_json(json.dumps(await request.json()))
        await bot.process_new_updates([update])
    except Exception as exc:
        print(f"Telegram update processing failed ({type(exc).__name__}).", flush=True)
        raise HTTPException(status_code=500, detail="Update processing failed") from exc
    return {"ok": True}


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "10000")),
        log_level="info",
    )
