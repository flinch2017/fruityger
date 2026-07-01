export const clearAuthStorage = () => {
  localStorage.setItem("fruitygerLoggedOut", "true");
  localStorage.removeItem("token");
  localStorage.removeItem("userId");
  localStorage.removeItem("username");
  localStorage.removeItem("account_name");
  localStorage.removeItem("profile_pic");
  localStorage.removeItem("emailVerified");
  localStorage.removeItem("interestsCompleted");
  localStorage.removeItem("pendingEmail");
  localStorage.removeItem("verificationEmail");
  window.dispatchEvent(new CustomEvent("fruityger:auth-changed"));
};

export const persistAuthSession = (data) => {
  localStorage.removeItem("fruitygerLoggedOut");
  if (data?.token) {
    localStorage.setItem("token", data.token);
  }

  if (data?.user?.id) {
    localStorage.setItem("userId", data.user.id);
  }

  if (data?.user?.username) {
    localStorage.setItem("username", data.user.username);
  }

  if (typeof data?.user?.account_name === "string" && data.user.account_name) {
    localStorage.setItem("account_name", data.user.account_name);
  } else {
    localStorage.removeItem("account_name");
  }

  if (typeof data?.user?.profile_pic === "string" && data.user.profile_pic) {
    localStorage.setItem("profile_pic", data.user.profile_pic);
  } else {
    localStorage.removeItem("profile_pic");
  }

  if (data?.user?.email) {
    localStorage.setItem("verificationEmail", data.user.email);
  }

  if (typeof data?.user?.pending_email === "string" && data.user.pending_email) {
    localStorage.setItem("pendingEmail", data.user.pending_email);
  } else {
    localStorage.removeItem("pendingEmail");
  }

  if (typeof data?.user?.email_verified === "boolean") {
    localStorage.setItem("emailVerified", String(data.user.email_verified));
  }

  if (typeof data?.user?.interests_completed === "boolean") {
    localStorage.setItem("interestsCompleted", String(data.user.interests_completed));
  }

  window.dispatchEvent(new CustomEvent("fruityger:auth-changed"));
};

export const fetchAuthSession = async () => {
  const token = localStorage.getItem("token");
  if (!token) {
    return { ok: false, reason: "missing-token" };
  }

  try {
    const res = await fetch("http://localhost:5000/api/auth/session", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        clearAuthStorage();
      }
      return { ok: false, reason: data.error || "session-failed" };
    }

    persistAuthSession(data);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, reason: "network-error" };
  }
};
