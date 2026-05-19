export const clearAdminSession = () => {
  localStorage.removeItem("adminToken");
  localStorage.removeItem("adminUser");
};

export const persistAdminSession = (payload) => {
  if (payload?.token) {
    localStorage.setItem("adminToken", payload.token);
  }

  if (payload?.admin) {
    localStorage.setItem("adminUser", JSON.stringify(payload.admin));
  }
};

export const fetchAdminSession = async () => {
  const token = localStorage.getItem("adminToken");

  if (!token) {
    return { ok: false, reason: "missing-token" };
  }

  try {
    const res = await fetch("http://localhost:5000/api/admin/session", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        clearAdminSession();
      }

      return { ok: false, reason: data.error || "session-failed" };
    }

    persistAdminSession({ token, admin: data.admin });
    return { ok: true, data };
  } catch {
    return { ok: false, reason: "network-error" };
  }
};
