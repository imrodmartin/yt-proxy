export default async (request, context) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const apiKey = Deno.env.get("YOUTUBE_API_KEY");
  if (!apiKey) return json({ error: "Server misconfiguration: missing API key" }, 500);

  const url = new URL(request.url);
  const handle = url.searchParams.get("handle");
  const channelId = url.searchParams.get("id");
  const topVideos = url.searchParams.get("topVideos");

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    // Top performing videos for the past year
    if (topVideos && channelId) {
      const publishedAfter = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const searchRes = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&order=viewCount&publishedAfter=${publishedAfter}&type=video&maxResults=5&key=${apiKey}`
      );
      const searchData = await searchRes.json();
      if (searchData.error) return json({ error: searchData.error.message }, 400, headers);
      if (!searchData.items?.length) return json([], 200, headers);

      const videoIds = searchData.items.map(i => i.id.videoId).join(",");
      const vRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds}&key=${apiKey}`
      );
      const vData = await vRes.json();
      if (vData.error) return json({ error: vData.error.message }, 400, headers);

      const videos = (vData.items || []).map(v => ({
        id: v.id,
        title: v.snippet.title,
        publishedAt: v.snippet.publishedAt,
        thumbnail: v.snippet.thumbnails?.medium?.url || "",
        viewCount: v.statistics.viewCount || "0",
        commentCount: v.statistics.commentCount || "0",
        url: `https://www.youtube.com/watch?v=${v.id}`,
      }));
      return json(videos, 200, headers);
    }

    let resolvedId = channelId;

    if (!resolvedId && handle) {
      const r = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`
      );
      const d = await r.json();
      if (d.error) return json({ error: d.error.message }, 400, headers);
      if (!d.items?.length) return json({ error: "Channel not found for that handle." }, 404, headers);
      resolvedId = d.items[0].id;
    }

    if (!resolvedId) return json({ error: "Provide handle or id parameter." }, 400, headers);

    const statsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${resolvedId}&key=${apiKey}`
    );
    const statsData = await statsRes.json();
    if (statsData.error) return json({ error: statsData.error.message }, 400, headers);
    if (!statsData.items?.length) return json({ error: "Channel not found." }, 404, headers);

    const ch = statsData.items[0];
    const uploadsPlaylistId = ch.contentDetails?.relatedPlaylists?.uploads;

    let videos = [];
    if (uploadsPlaylistId) {
      const plRes = await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=5&key=${apiKey}`
      );
      const plData = await plRes.json();

      if (plData.items?.length) {
        const videoIds = plData.items.map(i => i.snippet.resourceId.videoId).join(",");

        const vRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds}&key=${apiKey}`
        );
        const vData = await vRes.json();

        videos = (vData.items || []).map(v => ({
          id: v.id,
          title: v.snippet.title,
          publishedAt: v.snippet.publishedAt,
          thumbnail: v.snippet.thumbnails?.medium?.url || "",
          viewCount: v.statistics.viewCount || "0",
          commentCount: v.statistics.commentCount || "0",
          url: `https://www.youtube.com/watch?v=${v.id}`,
        }));
      }
    }

    return new Response(JSON.stringify({
      id: ch.id,
      title: ch.snippet.title,
      thumbnail: ch.snippet.thumbnails?.default?.url || "",
      subscriberCount: ch.statistics.subscriberCount || "0",
      viewCount: ch.statistics.viewCount || "0",
      videoCount: ch.statistics.videoCount || "0",
      publishedAt: ch.snippet.publishedAt,
      country: ch.snippet.country || "",
      videos,
    }), { headers });

  } catch (err) {
    return json({ error: err.message }, 500, headers);
  }
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}
