import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/EditProfile.css";

export default function EditProfile() {
  const [user, setUser] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    username: "",
    profile_pic: "",
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
          });
          setPreview(data.user.profile_pic || null);
        }
      } catch (err) {
        console.error(err);
      }
    };

    fetchUser();
  }, []);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

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

    let profilePicUrl = form.profile_pic;
    let profilePicKey = user?.profile_pic_key || null;

    try {
      // 🔹 1. Upload image to backend (which uploads to R2)
      if (selectedFile) {
        const uploadData = new FormData();
        uploadData.append("file", selectedFile);

        const uploadRes = await fetch(
          "http://localhost:5000/api/main/upload-pfp",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
            },
            body: uploadData,
          }
        );

        const uploadResult = await uploadRes.json();

        if (!uploadRes.ok) {
          alert("Image upload failed");
          return;
        }

        profilePicUrl = uploadResult.url;
        profilePicKey = uploadResult.key;
      }

      // 🔹 2. Update user profile
      const res = await fetch(
        "http://localhost:5000/api/main/edit-profile",
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            username: form.username,
            profile_pic: profilePicUrl,
            profile_pic_key: profilePicKey
          }),
        }
      );

      const data = await res.json();

      if (res.ok) {
        alert("Profile updated successfully!");
        setUser(data.user);
        setForm({ ...form, profile_pic: profilePicUrl });
      } else {
        alert(data.error || "Update failed");
      }
    } catch (err) {
      console.error(err);
      alert("Update request failed");
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
              required
            />
          </label>

          

          

          <button type="submit">
            Save Changes
          </button>
        </form>
      </div>
    </div>
  );
}