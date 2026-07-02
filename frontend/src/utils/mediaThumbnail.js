export const getMediaThumbnailUrl = (media) =>
  media?.thumbnail_url || (media?.media_type === "image" ? media?.media_url : "") || "";

export const getVideoPosterUrl = (media) =>
  media?.thumbnail_url || "";
