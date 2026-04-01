import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/EditProfile.css";

const normalizeUsername = (value = "") =>
  String(value)
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-+/g, "")
    .replace(/[^a-z0-9._]/g, "")
    .replace(/_+/g, "_")
    .replace(/\.+/g, ".")
    .replace(/^[^a-z]+/, "")
    .replace(/\.$/g, "");

export default function EditProfile() {
  const [user, setUser] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [alert, setAlert] = useState({ message: "", type: "" }); 
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    username: "",
    profile_pic: "",
    bio: "",
  });

  useEffect(() => {
    const fetchUser = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;

      try {
        const res = await fetch("http://localhost:5000/api/main/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();

        if (res.ok) {
          setUser(data.user);
          setForm({
            username: data.user.username,
            profile_pic: data.user.profile_pic || "",
            bio: data.user.bio || "",
          });
          setPreview(data.user.profile_pic || null);
        }
      } catch (err) {
        console.error(err);
      }
    };

    fetchUser();
  }, []);

  const showAlert = (message, type = "success", duration = 3000) => {
    setAlert({ message, type });
    setTimeout(() => setAlert({ message: "", type: "" }), duration);
  };

  const handleChange = (e) =>
    setForm({
      ...form,
      [e.target.name]:
        e.target.name === "username" ? normalizeUsername(e.target.value) : e.target.value,
    });

  // 📸 Handle file selection
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem("token");
    if (!token) return;

    setLoading(true); // start loading

    let profilePicUrl = form.profile_pic;
    let profilePicKey = user?.profile_pic_key || null;

    try {
      // 1. Upload image
      if (selectedFile) {
        const uploadData = new FormData();
        uploadData.append("file", selectedFile);

        const uploadRes = await fetch(
          "http://localhost:5000/api/main/upload-pfp",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: uploadData,
          }
        );

        const uploadResult = await uploadRes.json();
        if (!uploadRes.ok) {
          showAlert("Image upload failed", "error");
          setLoading(false);
          return;
        }

        profilePicUrl = uploadResult.url;
        profilePicKey = uploadResult.key;
      }

      // 2. Update profile
      const res = await fetch("http://localhost:5000/api/main/edit-profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          username: form.username,
          profile_pic: profilePicUrl,
          profile_pic_key: profilePicKey,
          bio: form.bio,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        showAlert("Profile updated successfully!", "success");
        setUser(data.user);
        setForm({ ...form, profile_pic: profilePicUrl, bio: data.user.bio || "" });

        // ✅ UPDATE LOCAL STORAGE
        localStorage.setItem("username", data.user.username);

        // (optional but good if you store it)
        localStorage.setItem("profile_pic", data.user.profile_pic || "");
        window.dispatchEvent(new CustomEvent("fruityger:profile-updated"));

        // redirect after a short delay
        setTimeout(() => navigate(`/profile/${data.user.username}`), 1000);
      } else {
        showAlert(data.error || "Update failed", "error");
      }
    } catch (err) {
      console.error(err);
      showAlert("Update request failed", "error");
    } finally {
      setLoading(false); // stop loading
    }
  };

  if (!user) {
    return (
      <div className="profile-loading">
        <div className="profile-spinner"></div>
        <p>Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="edit-profile-page">

      

      <div className="edit-profile-card">

        {alert.message && (
          <div className={`custom-alert ${alert.type}`}>
            {alert.message}
          </div>
        )}
        
        <button
          className="edit-close-btn"
          onClick={() => navigate(-1)}
        >
          ✕
        </button>
        <h2 className="edit-profile-title">Edit Profile</h2>

        {/* 🟢 Profile Picture Section */}
        <div className="pfp-section">
          <div className="pfp-preview">
            {preview ? (
              <img src={preview} alt="Profile Preview" />
            ) : (
              "👤"
            )}
          </div>

          <label className="pfp-upload-btn">
            Change Picture
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              hidden
            />
          </label>
        </div>

        <form
          className="edit-profile-form"
          onSubmit={handleSubmit}
        >
          <label>
            Username
            <input
              type="text"
              name="username"
              value={form.username}
              onChange={handleChange}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck="false"
              required
            />
            <span className="edit-profile-hint">
              Lowercase only. Must start with a letter. Spaces become underscores. Cannot end with a period.
            </span>
          </label>

          <label>
            Bio
            <textarea
              name="bio"
              value={form.bio}
              onChange={handleChange}
              maxLength={160}
              placeholder="Say something soft, nostalgic, or a little about yourself..."
            />
            <span className="edit-profile-hint">
              {form.bio.length}/160
            </span>
          </label>

          

          

          <button type="submit" disabled={loading}>
            <span className="button-label">
              {loading && <span className="spinner" aria-hidden="true"></span>}
              <span>Save Changes</span>
            </span>
          </button>
        </form>
      </div>
    </div>
  );
}
