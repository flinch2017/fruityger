import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

export default function Search() {
  const location = useLocation();
  const query = new URLSearchParams(location.search).get("q");

  const [result, setResult] = useState({
    users: [],
    posts: [],
    hashtags: []
  });

  useEffect(() => {
    if (!query) return;

    fetch(`/api/search?q=${encodeURIComponent(query)}`)
      .then(res => res.json())
      .then(data => setResult(data))
      .catch(console.error);

  }, [query]);

  return (
    <div className="search-page">

      <h2>Search Result: {query}</h2>

      <h3>Users</h3>
      {result.users.map(u => (
        <div key={u.id}>
          👤 {u.username}
        </div>
      ))}

      <h3>Posts</h3>
      {result.posts.map(p => (
        <div key={p.post_id} className="search-post-card">
          <strong>{p.username}</strong>
          <p>{p.caption}</p>
        </div>
      ))}

      <h3>Hashtags</h3>
      {result.hashtags.map(h => (
        <div key={h.tag}>
          #{h.tag}
        </div>
      ))}

    </div>
  );
}