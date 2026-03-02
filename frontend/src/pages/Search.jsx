import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import "../css/Search.css";

export default function Search() {
  const location = useLocation();
  const query = new URLSearchParams(location.search).get("q");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("profiles");
  const [result, setResult] = useState({
    users: [],
    posts: [],
    hashtags: []
  });

  useEffect(() => {
    if (!query) return;

    setLoading(true);

    fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then(res => res.json())
        .then(data => setResult(data))
        .catch(console.error)
        .finally(() => setLoading(false));

    }, [query]);

  return (
    <div className="search-page">
      <div className="search-header">
        <h2>Results for "{query}"</h2>
      </div>

      

      {/* 🔥 Tabs */}
      <div className="search-tabs">
        <button
          className={activeTab === "profiles" ? "active" : ""}
          onClick={() => setActiveTab("profiles")}
        >
          Profiles
        </button>

        <button
          className={activeTab === "posts" ? "active" : ""}
          onClick={() => setActiveTab("posts")}
        >
          Posts
        </button>

        <button
          className={activeTab === "hashtags" ? "active" : ""}
          onClick={() => setActiveTab("hashtags")}
        >
          Hashtags
        </button>
      </div>

      {/* 🔥 TAB CONTENT */}

      {/* 🔥 TAB CONTENT */}

<section className="search-section">
  {loading ? (
    <div className="search-loading">
      <div className="spinner"></div>
    </div>
  ) : (
    <>
      {activeTab === "profiles" && (
        <>
          {result.users.length === 0 ? (
            <p className="empty-text">No profiles found</p>
          ) : (
            result.users.map(u => (
              <div
                key={u.id}
                className="search-user-card clickable"
                onClick={() => navigate(`/profile/${u.username}`)}
                >
                <div className="avatar-placeholder">
                  {u.profile_pic ? (
                    <img src={u.profile_pic} alt={u.username} />
                  ) : (
                    "👤"
                  )}
                </div>
                <span>{u.username}</span>
              </div>
            ))
          )}
        </>
      )}

      {activeTab === "posts" && (
        <>
          {result.posts.length === 0 ? (
            <p className="empty-text">No posts found</p>
          ) : (
            result.posts.map(p => (
              <div key={p.post_id} className="search-post-card">
                <strong>{p.username}</strong>
                <p>{p.caption}</p>
              </div>
            ))
          )}
        </>
      )}

      {activeTab === "hashtags" && (
        <>
          {result.hashtags.length === 0 ? (
            <p className="empty-text">No hashtags found</p>
          ) : (
            result.hashtags.map(h => (
              <div key={h.tag} className="search-hashtag">
                #{h.tag}
              </div>
            ))
          )}
        </>
      )}
    </>
  )}
</section>
    </div>
  );
}