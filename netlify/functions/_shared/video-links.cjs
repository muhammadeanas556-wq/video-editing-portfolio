/*!
 * video-links.js — shared by the public portfolio, the admin panel and the
 * Netlify Functions, so every part of the site reads a link the same way.
 *
 * Supports: YouTube (videos, Shorts, live), TikTok (videos, short links),
 * Instagram (Reels, video posts, IGTV) and direct https video files
 * (.mp4 / .webm / .mov / .m4v — kept for links saved before this update).
 *
 * Videos are never downloaded or re-hosted: only the official embed players
 * on youtube-nocookie.com, tiktok.com and instagram.com are used.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VideoLinks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_LEN = 2048;
  var SLOT_IDS = ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5', 'slot-6'];
  var LABELS = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', file: 'Video file' };
  var SHAPES = ['auto', 'vertical', 'horizontal'];

  var YT_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];
  var YT_SHORT_HOSTS = ['youtu.be', 'www.youtu.be'];
  var TT_HOSTS = ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'];
  var TT_SHORT_HOSTS = ['vm.tiktok.com', 'vt.tiktok.com'];
  var IG_HOSTS = ['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am', 'www.instagr.am'];

  var YT_ID = /^[A-Za-z0-9_-]{11}$/;
  var TT_ID = /^\d{8,22}$/;
  var IG_CODE = /^[A-Za-z0-9_-]{5,64}$/;
  var TT_USER = /^[A-Za-z0-9._]{1,64}$/;
  var FILE_EXT = /\.(mp4|webm|mov|m4v)$/i;

  function fail(msg) { return { ok: false, error: msg }; }
  function has(list, v) { return list.indexOf(v) !== -1; }

  function toURL(input) {
    if (typeof input !== 'string') return null;
    var s = input.trim().replace(/\s+/g, '');
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
    try { return new URL(s); } catch (e) { return null; }
  }

  // "90", "1m30s", "1h2m3s" -> seconds
  function parseTime(v) {
    if (!v) return 0;
    if (/^\d+$/.test(v)) return Math.min(+v, 86400);
    var m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
    if (!m) return 0;
    return Math.min((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0), 86400);
  }

  function youtube(u, host) {
    var parts = u.pathname.split('/').filter(Boolean);
    var id = '', isShort = false;
    if (has(YT_SHORT_HOSTS, host)) id = parts[0] || '';
    else if (parts[0] === 'watch') id = u.searchParams.get('v') || '';
    else if (parts[0] === 'shorts') { id = parts[1] || ''; isShort = true; }
    else if (parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v' || parts[0] === 'e') id = parts[1] || '';
    else if (!parts.length && u.searchParams.get('v')) id = u.searchParams.get('v');
    else if (parts[0] === 'playlist' || parts[0] === 'channel' || parts[0] === 'c' || parts[0] === 'user' || (parts[0] || '').charAt(0) === '@')
      return fail('That is a YouTube channel or playlist link. Paste the link of a single video or Short.');
    if (!YT_ID.test(id)) return fail('This YouTube link has no valid video ID. Use a link like youtube.com/watch?v=… or youtube.com/shorts/….');
    var start = parseTime(u.searchParams.get('t') || u.searchParams.get('start') || '');
    return {
      ok: true, platform: 'youtube', id: id, kind: isShort ? 'short' : 'video',
      orientation: isShort ? 'vertical' : 'horizontal', start: start,
      url: isShort ? 'https://www.youtube.com/shorts/' + id : 'https://www.youtube.com/watch?v=' + id + (start ? '&t=' + start + 's' : ''),
      thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'
    };
  }

  function tiktok(u, host) {
    var parts = u.pathname.split('/').filter(Boolean);
    if (has(TT_SHORT_HOSTS, host) || parts[0] === 't') {
      var code = has(TT_SHORT_HOSTS, host) ? parts[0] : parts[1];
      if (!code || !/^[A-Za-z0-9]{4,32}$/.test(code)) return fail('This TikTok short link looks incomplete.');
      return {
        ok: true, platform: 'tiktok', id: null, kind: 'short-link', orientation: 'vertical', needsResolve: true,
        url: has(TT_SHORT_HOSTS, host) ? 'https://' + host + '/' + code + '/' : 'https://www.tiktok.com/t/' + code + '/',
        thumb: null
      };
    }
    var id = '', user = '';
    if (parts[0] && parts[0].charAt(0) === '@') {
      user = parts[0].slice(1);
      if (parts[1] === 'photo') return fail('That TikTok link is a photo post. Paste the link of a TikTok video.');
      if (parts[1] === 'live') return fail('TikTok LIVE streams cannot be embedded. Paste the link of a TikTok video.');
      if (parts[1] === 'video') id = parts[2] || '';
      else return fail('That is a TikTok profile link. Open the video and copy its link instead.');
    } else if (parts[0] === 'v') id = (parts[1] || '').replace(/\.html$/, '');
    else if (parts[0] === 'video') id = parts[1] || '';
    else if (parts[0] === 'embed') id = parts[1] === 'v2' ? (parts[2] || '') : (parts[1] || '');
    else if (parts[0] === 'player' && parts[1] === 'v1') id = parts[2] || '';
    if (!TT_ID.test(id)) return fail('This TikTok link has no valid video ID. Use a link like tiktok.com/@name/video/1234….');
    if (user && !TT_USER.test(user)) user = '';
    return {
      ok: true, platform: 'tiktok', id: id, kind: 'video', orientation: 'vertical', user: user,
      url: user ? 'https://www.tiktok.com/@' + user + '/video/' + id : 'https://www.tiktok.com/embed/v2/' + id,
      thumb: null
    };
  }

  function instagram(u) {
    var parts = u.pathname.split('/').filter(Boolean);
    // Newer share links put the username first: instagram.com/<user>/reel/<code>/
    if (parts.length >= 3 && /^(p|reel|reels|tv)$/.test(parts[1])) parts = parts.slice(1);
    var type = parts[0], code = parts[1] || '';
    if (type === 'stories' || type === 's') return fail('Instagram Stories and Highlights cannot be embedded. Paste a Reel or video post link.');
    if (!/^(p|reel|reels|tv)$/.test(type || '')) return fail('That looks like an Instagram profile or page. Paste the link of a Reel or video post.');
    if (!IG_CODE.test(code)) return fail('This Instagram link has no valid post code.');
    var isReel = type === 'reel' || type === 'reels';
    var path = isReel ? 'reel' : (type === 'tv' ? 'tv' : 'p');
    return {
      ok: true, platform: 'instagram', id: code, kind: isReel ? 'reel' : (type === 'tv' ? 'video' : 'post'),
      orientation: 'vertical', url: 'https://www.instagram.com/' + path + '/' + code + '/', thumb: null,
      note: path === 'p' ? 'Make sure this Instagram post is a video and the account is public.' : ''
    };
  }

  function file(u) {
    if (u.protocol !== 'https:') return fail('Video file links must start with https://');
    if (!FILE_EXT.test(u.pathname) && !(/(^|\.)cloudinary\.com$/.test(u.hostname) && /\/video\/upload\//.test(u.pathname)))
      return fail('Paste a link from Instagram, YouTube or TikTok.');
    return { ok: true, platform: 'file', id: null, kind: 'file', orientation: 'vertical', url: u.href, thumb: null };
  }

  /**
   * Read any pasted link. Returns { ok:true, platform, id, kind, orientation, url, thumb, ... }
   * or { ok:false, error }. An empty string is not an error: it returns { ok:true, empty:true }.
   */
  function parse(input) {
    if (input == null || String(input).trim() === '') return { ok: true, empty: true };
    var raw = String(input);
    if (raw.length > MAX_LEN) return fail('That link is too long.');
    var u = toURL(raw);
    if (!u) return fail('That is not a valid link.');
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return fail('Only web links (https://…) are allowed.');
    if (u.username || u.password) return fail('That link is not allowed.');
    var host = u.hostname.toLowerCase();
    var res;
    if (has(YT_HOSTS, host) || has(YT_SHORT_HOSTS, host)) res = youtube(u, host);
    else if (has(TT_HOSTS, host) || has(TT_SHORT_HOSTS, host)) res = tiktok(u, host);
    else if (has(IG_HOSTS, host)) res = instagram(u);
    else res = file(u);
    if (res.ok) { res.label = LABELS[res.platform]; res.original = raw.trim(); }
    return res;
  }

  function orientationOf(info, shape) {
    if (shape === 'vertical' || shape === 'horizontal') return shape;
    return (info && info.orientation) || 'vertical';
  }

  /** Official embed player URL for a parsed link (null for files and unresolved short links). */
  function embedUrl(info, opts) {
    opts = opts || {};
    if (!info || !info.ok || info.empty || !info.id) return null;
    var q;
    if (info.platform === 'youtube') {
      q = 'rel=0&playsinline=1&modestbranding=1';
      if (info.start) q += '&start=' + info.start;
      if (opts.autoplay) q += '&autoplay=1';
      return 'https://www.youtube-nocookie.com/embed/' + info.id + '?' + q;
    }
    if (info.platform === 'tiktok') {
      q = 'controls=1&progress_bar=1&play_button=1&volume_control=1&fullscreen_button=1&timestamp=1&music_info=1&description=1&rel=0&native_context_menu=1&closed_caption=1';
      if (opts.autoplay) q += '&autoplay=1';
      return 'https://www.tiktok.com/player/v1/' + info.id + '?' + q;
    }
    if (info.platform === 'instagram') {
      var path = info.kind === 'reel' ? 'reel' : (info.kind === 'video' ? 'tv' : 'p');
      return 'https://www.instagram.com/' + path + '/' + info.id + '/embed/';
    }
    return null;
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Safe <iframe> / <video> markup for a parsed link. */
  function playerHtml(info, opts) {
    opts = opts || {};
    if (!info || !info.ok || info.empty) return '';
    var title = escapeHtml(opts.title || ((info.label || 'Video') + ' video'));
    if (info.platform === 'file') {
      var poster = opts.poster && /^https:\/\//i.test(opts.poster) ? ' poster="' + escapeHtml(opts.poster) + '"' : '';
      return '<video src="' + escapeHtml(info.url) + '"' + poster + ' controls playsinline preload="metadata"' + (opts.autoplay ? ' autoplay' : '') + '></video>';
    }
    var src = embedUrl(info, opts);
    if (!src) return '';
    return '<iframe src="' + escapeHtml(src) + '" title="' + title + '" loading="lazy"' +
      ' allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write; web-share"' +
      ' allowfullscreen referrerpolicy="strict-origin-when-cross-origin" frameborder="0"></iframe>';
  }

  return {
    SLOT_IDS: SLOT_IDS, SHAPES: SHAPES, LABELS: LABELS,
    parse: parse, embedUrl: embedUrl, playerHtml: playerHtml,
    orientationOf: orientationOf, escapeHtml: escapeHtml
  };
});
