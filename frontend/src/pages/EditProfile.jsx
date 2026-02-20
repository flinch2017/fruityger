import React, { useEffect, useState } from "react";
import "../css/EditProfile.css";

export default function EditProfile() {
  const [user, setUser] = useState(null);
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
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
            email: data.user.email,
            password: "",
            profile_pic: data.user.profile_pic || "",
          });
        } else {
          console.error(data.error);
        }
      } catch (err) {
        console.error(err);
      }
    };

    fetchUser();
  }, []);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem("token");
    if (!token) return;

    try {
      const res = await fetch("http://localhost:5000/api/main/edit-profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (res.ok) {
        alert("Profile updated successfully!");
        setUser(data.user);
        setForm({ ...form, password: "" }); // clear password field
      } else {
        alert(data.error || "Update failed");
      }
    } catch (err) {
      console.error(err);
      alert("Update request failed");
    }
  };

  if (!user) return <p>Loading profile...</p>;

  return (
    <div className="edit-profile-page">
      <div className="edit-profile-card">
        <h2 className="edit-profile-title">Edit Profile</h2>

        <form className="edit-profile-form" onSubmit={handleSubmit}>
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

          <label>
            Email
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Profile Picture URL
            <input
              type="text"
              name="profile_pic"
              value={form.profile_pic}
              onChange={handleChange}
            />
          </label>

          <label>
            New Password (leave blank to keep current)
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
            />
          </label>

          <button type="submit">Save Changes</button>
        </form>
      </div>
    </div>
  );
}