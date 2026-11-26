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
import secrets
import shutil
import time
import urllib.request
from urllib.parse import quote, urlparse
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials as firebase_credentials, firestore
from google.api_core.exceptions import AlreadyExists
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
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
TIKIP_API_URL = "https://shinyfrydgdghfdgdgmouse-a6de.issam1996kech.workers.dev/api/v1/profile"
MAX_LOOKUP_SECONDS = 15
EXPECTED_LOOKUP_SECONDS = 10
CACHE_TTL_SECONDS = 10 * 60
SOURCE_ATTEMPT_TIMEOUT_SECONDS = 15
SOURCE_TIMEOUT_MILLISECONDS = SOURCE_ATTEMPT_TIMEOUT_SECONDS * 1_000
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


def _format_source_timestamp(value) -> str:
    if value in (None, "", 0, "0", False, "Never", "N/A"):
        return "Never"
    try:
        timestamp = float(value)
        if timestamp > 0:
            if timestamp >= 1e12:
                timestamp /= 1000
            return datetime.fromtimestamp(timestamp, timezone.utc).strftime(
                "%-m/%-d/%Y, %-I:%M:%S %p"
            )
    except (TypeError, ValueError, OverflowError, OSError):
        pass
    return str(value)


def _format_tikip_metric(value) -> str:
    if value is None:
        return "Unavailable"
    try:
        number = int(value)
        if str(number) == str(value).strip() or isinstance(value, int):
            return f"{number:,}"
    except (TypeError, ValueError):
        pass
    return str(value)


def format_tikip_api_result(username: str, payload: dict):
    """Format Tikip's public JSON response into the existing Arabic profile card."""
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return f"لم تظهر بيانات واضحة للحساب @{username}. جرّب مرة أخرى لاحقًا."

    user = data.get("user") if isinstance(data.get("user"), dict) else {}
    stats = data.get("stats") if isinstance(data.get("stats"), dict) else {}
    profile_username = str(user.get("uniqueId") or username).lstrip("@")
    nickname = str(user.get("nickname") or f"@{profile_username}")
    lines = [nickname, f"@{profile_username}"]
    bio = str(user.get("signature") or "").strip()
    if bio:
        lines.append(bio)

    region = (
        data.get("current_region_name")
        or user.get("current_region_name")
        or data.get("current_region")
        or "Unavailable"
    )
    if isinstance(region, str) and len(region.strip()) == 2:
        region = "Unavailable"
    lines.extend([
        "ESTIMATED CURRENT REGION", str(region),
        "JOINED", _format_source_timestamp(user.get("createTime")),
        "LANGUAGE", str(user.get("language") or "Unavailable"),
        "USER ID", str(user.get("id") or "Unavailable"),
        "NICKNAME UPDATED",
        _format_source_timestamp(
            user.get("nickNameModifyTime")
            or data.get("nick_name_modify_time")
            or data.get("nickname_modify_time")
        ),
        "USERNAME UPDATED",
        _format_source_timestamp(
            user.get("uniqueIdModifyTime")
            or data.get("unique_id_modify_time")
            or data.get("username_modify_time")
        ),
    ])

    followers = stats.get("followerCount")
    hearts = stats.get("heartCount")
    videos = stats.get("videoCount")
    following = stats.get("followingCount")
    friends = stats.get("friendCount")
    lines.extend([
        "FOLLOWERS", _format_tikip_metric(followers),
        "HEARTS", _format_tikip_metric(hearts),
        "VIDEOS", _format_tikip_metric(videos),
        "FOLLOWING", _format_tikip_metric(following),
        "FRIENDS", _format_tikip_metric(friends),
    ])

    try:
        follower_count = float(followers or 0)
        heart_count = float(hearts or 0)
        video_count = float(videos or 0)
        hearts_per_follower = heart_count / follower_count if follower_count else 0
        engagement = (
            heart_count / video_count / follower_count * 100
            if video_count and follower_count else 0
        )
        lines.extend([
            "HEARTS PER FOLLOWER", f"{hearts_per_follower:.2f}",
            "EST. ENGAGEMENT", f"{engagement:.2f}%",
        ])
    except (TypeError, ValueError, ZeroDivisionError):
        pass

    plain_text = format_tikip_result(username, "\n".join(lines))
    avatar_url = str(user.get("avatarLarger") or user.get("avatarMedium") or "")
    parsed_avatar = urlparse(avatar_url)
    if parsed_avatar.scheme != "https" or not parsed_avatar.hostname:
        avatar_url = ""
    return {
        "text": plain_text,
        "markdown": format_tikip_rich_markdown(username, plain_text, avatar_url),
        "avatar_url": avatar_url,
    }


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
        encoded = os.environ.get("TIKWAHM_PROXY_LIST_B64", "").strip()
        if encoded:
            content = base64.b64decode(encoded, validate=True).decode("utf-8")
        else:
            with open(path, "r", encoding="utf-8") as proxy_file:
                content = proxy_file.read()
        for raw_line in content.splitlines():
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
    except (OSError, ValueError, UnicodeError):
        return []
    return proxies


PROXY_DASHBOARD_FILE = os.environ.get(
    "TIKWAHM_PROXY_DASHBOARD_FILE",
    os.path.join(os.path.dirname(__file__), "proxy_dashboard.json"),
).strip()

FIREBASE_SERVICE_ACCOUNT_JSON = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
_FIRESTORE_PROXY_DOCUMENT = None
_FIRESTORE_CLIENT = None
_FIRESTORE_PROXY_VERSION = 0
if FIREBASE_SERVICE_ACCOUNT_JSON:
    try:
        _firebase_service_account = json.loads(FIREBASE_SERVICE_ACCOUNT_JSON)
        _firebase_project_id = _firebase_service_account.get("project_id")
        if not isinstance(_firebase_service_account, dict) or not _firebase_project_id:
            raise ValueError("missing project_id")
        _firebase_app = firebase_admin.initialize_app(
            firebase_credentials.Certificate(_firebase_service_account),
            {"projectId": _firebase_project_id},
            name="tikwahm_proxy_dashboard",
        )
        _FIRESTORE_CLIENT = firestore.client(app=_firebase_app)
        _FIRESTORE_PROXY_DOCUMENT = _FIRESTORE_CLIENT.collection("private_config").document("proxy_dashboard")
    except Exception:
        raise RuntimeError(
            "تعذر تهيئة Firebase. تحقق من قيمة FIREBASE_SERVICE_ACCOUNT_JSON وصلاحية حساب الخدمة."
        ) from None


def _parse_proxy_source_line(raw_line: str):
    line = raw_line.strip()
    enabled = True
    if line.casefold().startswith("# disabled:"):
        enabled = False
        line = line.split(":", 1)[1].strip()
    elif not line or line.startswith("#"):
        return None
    parts = line.split(":", 3)
    if len(parts) != 4:
        return None
    host, port, username, password = parts
    if (
        not host or not re.fullmatch(r"[A-Za-z0-9.-]+", host)
        or ".." in host or not port.isdigit() or not username or not password
        or any(char in username + password for char in "\r\n\x00")
    ):
        return None
    port_number = int(port)
    if not 1 <= port_number <= 65535:
        return None
    return {
        "id": secrets.token_urlsafe(12),
        "host": host.rstrip("."),
        "port": port_number,
        "username": username,
        "password": password,
        "enabled": enabled,
    }


def _load_proxy_admin_entries(path: str):
    try:
        encoded = os.environ.get("TIKWAHM_PROXY_LIST_B64", "").strip()
        if encoded:
            content = base64.b64decode(encoded, validate=True).decode("utf-8")
        else:
            with open(path, "r", encoding="utf-8") as proxy_file:
                content = proxy_file.read()
    except (OSError, ValueError, UnicodeError):
        return []
    entries = []
    for raw_line in content.splitlines():
        parsed = _parse_proxy_source_line(raw_line)
        if parsed is not None:
            entries.append(parsed)
    return entries


def _normalize_proxy_dashboard_entries(entries):
    if not isinstance(entries, list):
        return None
    loaded = []
    for entry in entries:
        if not isinstance(entry, dict):
            return None
        parsed = _parse_proxy_source_line(
            f"{entry.get('host', '')}:{entry.get('port', '')}:"
            f"{entry.get('username', '')}:{entry.get('password', '')}"
        )
        if parsed is None:
            return None
        proxy_id = str(entry.get("id", ""))
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", proxy_id):
            proxy_id = secrets.token_urlsafe(12)
        parsed["id"] = proxy_id
        parsed["enabled"] = bool(entry.get("enabled", True))
        loaded.append(parsed)
    return loaded


def _load_proxy_dashboard_state():
    try:
        with open(PROXY_DASHBOARD_FILE, "r", encoding="utf-8") as state_file:
            payload = json.load(state_file)
        entries = payload.get("proxies") if isinstance(payload, dict) else None
        return _normalize_proxy_dashboard_entries(entries)
    except (OSError, ValueError, UnicodeError, TypeError):
        return None


def _proxy_payload_version(payload):
    version = payload.get("version") if isinstance(payload, dict) else None
    return version if isinstance(version, int) and not isinstance(version, bool) and version >= 1 else 1


_PROXY_ADMIN_ENTRIES = (
    _load_proxy_admin_entries(PROXY_LIST_PATH)
    if _FIRESTORE_PROXY_DOCUMENT is not None and os.environ.get("TIKWAHM_PROXY_LIST_B64", "").strip()
    else _load_proxy_dashboard_state()
)
if _PROXY_ADMIN_ENTRIES is None:
    _PROXY_ADMIN_ENTRIES = _load_proxy_admin_entries(PROXY_LIST_PATH)
_PROXY_POOL = [dict(proxy) for proxy in _PROXY_ADMIN_ENTRIES if proxy.get("enabled", True)]
_ACTIVE_PROXY_INDEX = 0
_PROXY_LOCK = asyncio.Lock()


async def _save_proxy_admin_entries(entries):
    """Persist credentials remotely when configured, then refresh the live pool."""
    global _PROXY_ADMIN_ENTRIES, _PROXY_POOL, _ACTIVE_PROXY_INDEX, _FIRESTORE_PROXY_VERSION
    payload = {"version": _FIRESTORE_PROXY_VERSION or 1, "saved_at": int(time.time()), "proxies": entries}
    if _FIRESTORE_PROXY_DOCUMENT is not None:
        expected_version = _FIRESTORE_PROXY_VERSION
        next_payload = {**payload, "version": expected_version + 1}
        serialized_size = len(json.dumps(next_payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        if serialized_size > 900_000:
            raise HTTPException(status_code=413, detail="قائمة البروكسيات أكبر من الحد الآمن لوثيقة Firestore.")
        def commit_if_current():
            transaction = _FIRESTORE_CLIENT.transaction()

            @firestore.transactional
            def update(tx):
                snapshots = list(tx.get_all([_FIRESTORE_PROXY_DOCUMENT]))
                snapshot = snapshots[0] if snapshots else None
                current_version = _proxy_payload_version(snapshot.to_dict() if snapshot.exists else None)
                if not snapshot.exists or current_version != expected_version:
                    raise RuntimeError("proxy_dashboard_conflict")
                tx.set(_FIRESTORE_PROXY_DOCUMENT, next_payload)
                return current_version + 1

            return update(transaction)

        try:
            _FIRESTORE_PROXY_VERSION = await asyncio.to_thread(commit_if_current)
        except RuntimeError as exc:
            if str(exc) == "proxy_dashboard_conflict":
                # Reject the stale write, but first replace the in-process pool
                # with the winning remote version so subsequent reads are fresh.
                latest_snapshot = await asyncio.to_thread(_FIRESTORE_PROXY_DOCUMENT.get)
                if not latest_snapshot.exists:
                    raise HTTPException(status_code=503, detail="تعذر استعادة إعدادات البروكسيات بعد التعارض.") from None
                latest_payload = latest_snapshot.to_dict() or {}
                latest_entries = _normalize_proxy_dashboard_entries(latest_payload.get("proxies"))
                if latest_entries is None:
                    raise HTTPException(status_code=503, detail="وثيقة البروكسيات البعيدة غير صالحة بعد التعارض.") from None
                async with _PROXY_LOCK:
                    _PROXY_ADMIN_ENTRIES = [dict(proxy) for proxy in latest_entries]
                    _PROXY_POOL = [dict(proxy) for proxy in latest_entries if proxy.get("enabled", True)]
                    _ACTIVE_PROXY_INDEX = 0
                    _FIRESTORE_PROXY_VERSION = _proxy_payload_version(latest_payload)
                raise HTTPException(status_code=409, detail="تعارض: تغيّر إعداد البروكسيات في نسخة أخرى. أعد تحميل الصفحة قبل الحفظ.") from None
            raise
    else:
        parent = os.path.dirname(PROXY_DASHBOARD_FILE) or "."
        os.makedirs(parent, exist_ok=True)
        temp_path = f"{PROXY_DASHBOARD_FILE}.{secrets.token_hex(8)}.tmp"
        try:
            descriptor = os.open(temp_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as state_file:
                json.dump(payload, state_file, ensure_ascii=False, separators=(",", ":"))
                state_file.flush()
                os.fsync(state_file.fileno())
            os.replace(temp_path, PROXY_DASHBOARD_FILE)
            os.chmod(PROXY_DASHBOARD_FILE, 0o600)
        finally:
            try:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
            except OSError:
                pass

    source_lines = []
    for proxy in entries:
        line = f"{proxy['host']}:{proxy['port']}:{proxy['username']}:{proxy['password']}"
        source_lines.append(line if proxy.get("enabled", True) else f"# disabled: {line}")
    encoded = base64.b64encode(("\n".join(source_lines) + ("\n" if source_lines else "")).encode("utf-8")).decode("ascii")
    async with _PROXY_LOCK:
        _PROXY_ADMIN_ENTRIES = [dict(proxy) for proxy in entries]
        _PROXY_POOL = [dict(proxy) for proxy in entries if proxy.get("enabled", True)]
        _ACTIVE_PROXY_INDEX = 0
        os.environ["TIKWAHM_PROXY_LIST_B64"] = encoded


async def _initialize_proxy_storage():
    """Load Firestore state or migrate the existing file/environment list once."""
    global _PROXY_ADMIN_ENTRIES, _PROXY_POOL, _ACTIVE_PROXY_INDEX, _FIRESTORE_PROXY_VERSION
    if _FIRESTORE_PROXY_DOCUMENT is None:
        return

    snapshot = await asyncio.to_thread(_FIRESTORE_PROXY_DOCUMENT.get)
    if snapshot.exists:
        payload = snapshot.to_dict() or {}
        entries = _normalize_proxy_dashboard_entries(payload.get("proxies"))
        if entries is None:
            raise RuntimeError("وثيقة البروكسيات في Firestore غير صالحة؛ أوقف التشغيل لتجنب فقد البيانات.")
        remote_version = _proxy_payload_version(payload)
    else:
        entries = _PROXY_ADMIN_ENTRIES
        payload = {"version": 1, "saved_at": int(time.time()), "proxies": entries}
        serialized_size = len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        if serialized_size > 900_000:
            raise RuntimeError("قائمة البروكسيات أكبر من الحد الآمن لوثيقة Firestore.")
        try:
            await asyncio.to_thread(_FIRESTORE_PROXY_DOCUMENT.create, payload)
        except AlreadyExists:
            snapshot = await asyncio.to_thread(_FIRESTORE_PROXY_DOCUMENT.get)
            if not snapshot.exists:
                raise RuntimeError("تعذر قراءة وثيقة البروكسيات بعد تعارض الترحيل.")
            payload = snapshot.to_dict() or {}
            entries = _normalize_proxy_dashboard_entries(payload.get("proxies"))
            if entries is None:
                raise RuntimeError("وثيقة البروكسيات في Firestore غير صالحة؛ أوقف التشغيل لتجنب فقد البيانات.")
            remote_version = _proxy_payload_version(payload)
        else:
            remote_version = 1

    async with _PROXY_LOCK:
        _PROXY_ADMIN_ENTRIES = [dict(proxy) for proxy in entries]
        _PROXY_POOL = [dict(proxy) for proxy in entries if proxy.get("enabled", True)]
        _ACTIVE_PROXY_INDEX = 0
        _FIRESTORE_PROXY_VERSION = remote_version


async def _test_proxy_connection(proxy):
    def check():
        proxy_url = (
            f"http://{quote(proxy['username'], safe='')}:{quote(proxy['password'], safe='')}"
            f"@{proxy['host']}:{proxy['port']}"
        )
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url})
        )
        request = urllib.request.Request(
            "https://api.ipify.org?format=json",
            headers={"User-Agent": "TikWahm-Proxy-Check/1.0"},
        )
        try:
            with opener.open(request, timeout=12) as response:
                data = json.loads(response.read(512).decode("utf-8", "replace"))
            ip = str(data.get("ip", ""))
            return {"ok": bool(ip), "ip": ip[:80]}
        except Exception as exc:
            return {"ok": False, "reason": type(exc).__name__}

    return await asyncio.to_thread(check)

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
)
_PROVIDER_RESTRICTION_MESSAGE = (
    "المصدر أبلغ عن حظر أو تحقق أمني أو رفض وصول في هذه المحاولة. "
    "تم تبديل البروكسي للمحاولة القادمة؛ جرّب إعادة المحاولة."
)


class _ProxyConnectionBroken(Exception):
    """Raised only for an explicit transport/proxy connection failure."""


class _RetryableTikipError(Exception):
    """Raised for source failures that are safe to retry with another proxy."""


def _is_connection_failure(error_or_text) -> bool:
    text = str(error_or_text or "").casefold()
    return any(marker in text for marker in _CONNECTION_FAILURE_MARKERS)


def _proxy_launch_config(proxy):
    return {
        "server": f"http://{proxy['host']}:{proxy['port']}",
        "username": proxy["username"],
        "password": proxy["password"],
    }


def _proxy_key(proxy):
    return (
        proxy.get("id") or proxy.get("host"),
        proxy.get("port"),
        proxy.get("username"),
    )


async def _get_next_proxy(excluded=None):
    """سحب بروكسي غير مستخدم في البحث مع تدوير ذري للمؤشر."""
    global _ACTIVE_PROXY_INDEX
    excluded = excluded or set()
    async with _PROXY_LOCK:
        total = len(_PROXY_POOL)
        if total == 0:
            return None, -1
        for offset in range(total):
            current_index = (_ACTIVE_PROXY_INDEX + offset) % total
            proxy = _PROXY_POOL[current_index]
            if _proxy_key(proxy) in excluded:
                continue
            _ACTIVE_PROXY_INDEX = (current_index + 1) % total
            return proxy, current_index
        return None, -1


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
    source_hosts = {
        (urlparse(TIKIP_URL).hostname or "").casefold(),
        (urlparse(TIKIP_API_URL).hostname or "").casefold(),
    }
    denied_statuses = []
    connection_failures = []
    try:
        _set_progress(progress, "تهيئة البحث")
        async with async_playwright() as p:
            options = {"headless": True}
            if proxy:
                options["proxy"] = _proxy_launch_config(proxy)
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
                    if response_host in source_hosts and response.status in {401, 403, 429}:
                        denied_statuses.append(response.status)
                except Exception:
                    pass

            def record_failed_request(request):
                try:
                    request_host = (urlparse(request.url).hostname or "").casefold()
                    relevant_type = request.resource_type in {"document", "xhr", "fetch"}
                    if (request_host in source_hosts and relevant_type
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

            _set_progress(progress, "البحث عن الحساب وجمع بياناته")
            try:
                api_result = await page.evaluate(
                    """async ({endpoint, username, timeoutMs}) => {
                        const controller = new AbortController();
                        const timer = setTimeout(() => controller.abort(), timeoutMs);
                        try {
                            const response = await fetch(
                                endpoint + '?username=' + encodeURIComponent(username),
                                { signal: controller.signal, cache: 'no-store' }
                            );
                            let body = null;
                            try { body = await response.json(); } catch (_) {}
                            return { status: response.status, body };
                        } catch (error) {
                            return { error: error && error.message ? error.message : 'NetworkError' };
                        } finally {
                            clearTimeout(timer);
                        }
                    }""",
                    {
                        "endpoint": TIKIP_API_URL,
                        "username": username,
                        "timeoutMs": SOURCE_TIMEOUT_MILLISECONDS,
                    },
                )
            except Exception as exc:
                if denied_statuses or await _page_shows_provider_restriction(page, denied_statuses):
                    return _PROVIDER_RESTRICTION_MESSAGE
                if _is_connection_failure(exc) or connection_failures:
                    raise _ProxyConnectionBroken from exc
                raise

            if await _page_shows_provider_restriction(page, denied_statuses):
                return _PROVIDER_RESTRICTION_MESSAGE

            if not isinstance(api_result, dict):
                if connection_failures:
                    raise _ProxyConnectionBroken
                raise _RetryableTikipError("invalid_browser_response")
            if api_result.get("error"):
                if connection_failures:
                    raise _ProxyConnectionBroken
                if "abort" in str(api_result["error"]).casefold():
                    raise _RetryableTikipError("source_timeout")
                raise _ProxyConnectionBroken

            status = api_result.get("status")
            if status in {401, 403, 429}:
                return _PROVIDER_RESTRICTION_MESSAGE
            if not isinstance(status, int) or status < 200 or status >= 300:
                if connection_failures:
                    raise _ProxyConnectionBroken
                if isinstance(status, int) and status >= 500:
                    raise _RetryableTikipError(f"source_http_{status}")
                return f"رفض مصدر البيانات الطلب (HTTP {status}). جرّب لاحقًا."

            payload = api_result.get("body")
            if not isinstance(payload, dict):
                raise _RetryableTikipError("invalid_json")
            if payload.get("status") == "error":
                return str(payload.get("message") or payload.get("error") or "لم يعثر المصدر على بيانات عامة للحساب.")

            _set_progress(progress, "وصلت البيانات؛ جارٍ تنسيق النتيجة")
            return format_tikip_api_result(username, payload)
    finally:
        if browser is not None:
            try:
                await browser.close()
            except Exception:
                pass


async def fetch_data_from_tikip(username: str, progress=None):
    """نفّذ دورة بحث محدودة، مع حجز بروكسي مختلف لكل محاولة فاشلة أو مكتملة."""
    if not _PROXY_POOL:
        return (
            "لا يمكن إجراء البحث: ملف إعداد البروكسي غير متاح أو لا يحتوي إدخالات صالحة. "
            "لم يتم الاتصال مباشرة."
        )

    total_proxies = len(_PROXY_POOL)
    last_error = None
    used_proxies = set()
    for _ in range(total_proxies):
        proxy, proxy_index = await _get_next_proxy(used_proxies)
        if proxy is None:
            break
        used_proxies.add(_proxy_key(proxy))
        print(f"Using proxy slot #{proxy_index + 1}/{total_proxies} for @{username}", flush=True)
        try:
            async with _BROWSER_SEMAPHORE:
                result = await asyncio.wait_for(
                    _fetch_once_through_proxy(username, proxy, progress),
                    timeout=SOURCE_ATTEMPT_TIMEOUT_SECONDS,
                )
            return result
        except _ProxyConnectionBroken:
            # في حال فشل الاتصال بالبروكسي، تستمر الحلقة وتجرب البروكسي التالي تلقائياً
            print(f"Proxy slot #{proxy_index + 1} connection failed, rotating to next...", flush=True)
            continue
        except (asyncio.TimeoutError, PlaywrightTimeoutError, _RetryableTikipError):
            last_error = "انتهت مهلة أو تعذر قراءة رد مصدر البيانات."
            print(f"Proxy slot #{proxy_index + 1} timed out, rotating to next...", flush=True)
            continue
        except Exception as exc:
            last_error = f"تعذر إكمال البحث بسبب مشكلة في المتصفح أو الموقع ({type(exc).__name__})."
            print(f"Proxy slot #{proxy_index + 1} failed ({type(exc).__name__}), rotating to next...", flush=True)
            continue

    if last_error:
        return f"{last_error} جُرّبت البروكسيات المتاحة، حاول مرة أخرى لاحقًا."
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
    await _initialize_proxy_storage()
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

from proxy_admin import DEFAULT_PASSWORD_HASH, build_proxy_admin_router

_PROXY_ADMIN_PASSWORD_HASH = (
    os.environ.get("TIKWAHM_PROXY_DASHBOARD_PASSWORD_HASH", "").strip()
    or DEFAULT_PASSWORD_HASH
)
app.include_router(
    build_proxy_admin_router(
        get_entries=lambda: [dict(proxy) for proxy in _PROXY_ADMIN_ENTRIES],
        save_entries=_save_proxy_admin_entries,
        get_session_secret=lambda: WEBHOOK_SECRET or WEBHOOK_SECRET_SEED or BOT_TOKEN,
        test_proxy=_test_proxy_connection,
        password_hash=_PROXY_ADMIN_PASSWORD_HASH,
        password_pepper=lambda: BOT_TOKEN,
        storage_backend=lambda: "firestore" if _FIRESTORE_PROXY_DOCUMENT is not None else "file",
    )
)

@app.middleware("http")
async def proxy_admin_security_headers(request: Request, call_next):
    if request.url.path.startswith("/proxy-admin"):
        forwarded_scheme = request.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip().lower()
        scheme = forwarded_scheme or request.url.scheme
        if scheme != "https":
            return PlainTextResponse("HTTPS is required for the proxy dashboard.", status_code=400)
    response = await call_next(request)
    if request.url.path.startswith("/proxy-admin"):
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
    return response


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
