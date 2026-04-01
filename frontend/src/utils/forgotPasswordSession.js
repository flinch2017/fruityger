const ACCOUNT_KEY = "fruitygerForgotPasswordAccount";
const TOKEN_KEY = "fruitygerForgotPasswordResetToken";

export const getForgotPasswordAccount = () => {
  try {
    const raw = sessionStorage.getItem(ACCOUNT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const setForgotPasswordAccount = (account) => {
  sessionStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
};

export const clearForgotPasswordAccount = () => {
  sessionStorage.removeItem(ACCOUNT_KEY);
};

export const getForgotPasswordResetToken = () =>
  sessionStorage.getItem(TOKEN_KEY) || "";

export const setForgotPasswordResetToken = (token) => {
  sessionStorage.setItem(TOKEN_KEY, token);
};

export const clearForgotPasswordResetToken = () => {
  sessionStorage.removeItem(TOKEN_KEY);
};

export const clearForgotPasswordSession = () => {
  clearForgotPasswordAccount();
  clearForgotPasswordResetToken();
};
