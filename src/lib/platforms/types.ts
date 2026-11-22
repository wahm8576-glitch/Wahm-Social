/** Shared, platform-agnostic domain model used across the whole app. */

export type Platform = "tiktok" | "instagram";
export const PLATFORMS: Platform[] = ["tiktok", "instagram"];

export function isPlatform(v: string): v is Platform {
  return v === "tiktok" || v === "instagram";
}

export type DataSource = "live" | "cache" | "demo";

export interface Profile {
  platform: Platform;
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  verified: boolean;
  isPrivate: boolean;
  isBusiness?: boolean;
  category?: string;
  externalUrl?: string;
  followers: number;
  following: number;
  likes?: number;
  postsCount: number;
  createdAt?: number;
  region?: string;
  language?: string;
  hasStory?: boolean;
  /** TikTok: 1 = following list visible to everyone. */
  followingVisibility?: number;
  location?: ProfileLocation;
  /** TikTok stable public id used by its web endpoints. */
  secUid?: string;
  /** Profile data came from the platform's public link-preview (limited fields). */
  preview?: boolean;
  profileUrl: string;
}

export type MediaType = "video" | "image" | "carousel";

export interface MediaItem {
  type: "video" | "image";
  url: string;
  thumbnail?: string;
  width?: number;
  height?: number;
}

export interface Post {
  platform: Platform;
  id: string;
  shortcode?: string;
  author: string;
  caption: string;
  type: MediaType;
  cover: string;
  media: MediaItem[];
  createdAt?: number;
  duration?: number;
  stats: {
    views?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    saves?: number;
  };
  hashtags: string[];
  music?: { title: string; author: string; url?: string };
  url: string;
  /** TikTok: ISO country where the video was posted, and a tagged place (if any). */
  location?: { country?: string; place?: string };
}

/** Where a public account posts from, derived from its own public videos. */
export interface ProfileLocation {
  /** ISO-3166 alpha-2 country shown on the profile. */
  current?: string;
  /** Where current came from: the account's own region field, or videos. */
  source?: "profile" | "video";
  /** For video-derived countries: TikTok's own video pages or tikwm's per-video region. */
  via?: "tiktok" | "tikwm";
  /** Most recent tagged place name, if the creator tagged one. */
  place?: string;
  /** Countries seen across the sampled recent videos, most frequent first. */
  recent: { code: string; count: number }[];
  sample: number;
  /** Language set on the account / used in captions. */
  language?: string;
}

export interface Story {
  platform: Platform;
  id: string;
  author: string;
  type: "video" | "image";
  url: string;
  thumbnail: string;
  takenAt?: number;
  expiresAt?: number;
}

export interface Connection {
  username: string;
  displayName: string;
  avatarUrl: string;
  verified: boolean;
  /** Unix seconds of the public activity that surfaced this account (e.g. a comment). */
  activeAt?: number;
  /** Short public context, e.g. the comment text. */
  note?: string;
}

export interface ConnectionAttempt {
  method: "official_api" | "web_public" | "mobile_web" | "session" | "third_party" | "instagram_session";
  ok: boolean;
  /** Short machine-readable reason, e.g. "not_approved", "empty_unsigned", "not_configured". */
  note: string;
}

export type ConnectionsReason =
  | "account_private" // the account itself is private → never shown
  | "hidden_by_user" // the owner hid this list in their privacy settings
  | "provider_required" // list is public but needs an official API provider to be configured
  | "login_only" // platform only shows this list to signed-in users
  | "not_supported";

export interface ConnectionsResult {
  available: boolean;
  reason?: ConnectionsReason;
  /** "public" when the account owner allows this list to be seen. */
  visibility: "public" | "hidden" | "private" | "unknown";
  total?: number;
  items: Connection[];
  nextCursor?: string | null;
  provider?: string;
  /** Deep link to view the list on the platform itself. */
  platformUrl?: string;
  /** Every method tried to read the real list, in order, with its outcome (shown to the user). */
  attempts?: ConnectionAttempt[];
}

export interface PostComment {
  id: string;
  text: string;
  authorName?: string;
  username?: string;
  likes?: number;
}

export interface PostCommentsResult {
  status: "available" | "empty" | "unavailable" | "session_required";
  comments: PostComment[];
  /** True only when each returned comment has a like count. */
  rankedByLikes: boolean;
  /** Number of comments inspected before keeping the top five. */
  sampleSize: number;
}

export interface Envelope<T> {
  ok: true;
  source: DataSource;
  fetchedAt: number;
  data: T;
  notice?: string;
}

export interface ErrorEnvelope {
  ok: false;
  error: { code: ErrorCode; message: string };
}

export type ErrorCode =
  | "not_found"
  | "private_account"
  | "blocked"
  | "rate_limited"
  | "invalid_input"
  | "pro_required"
  | "unauthorized"
  | "upstream_error"
  | "internal";

export class PlatformError extends Error {
  constructor(public code: ErrorCode, message: string, public status = 400) {
    super(message);
    this.name = "PlatformError";
  }
}

export interface PlatformAdapter {
  platform: Platform;
  getProfile(username: string): Promise<Profile>;
  getPosts(username: string, opts?: { limit?: number }): Promise<Post[]>;
  getPost(idOrUrl: string, username?: string): Promise<Post>;
  getComments(post: Post): Promise<PostCommentsResult>;
  getStories(username: string): Promise<Story[]>;
}
