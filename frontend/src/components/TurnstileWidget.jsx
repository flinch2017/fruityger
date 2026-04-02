import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

let turnstileScriptPromise = null;

const loadTurnstileScript = () => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Turnstile is only available in the browser"));
  }

  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }

  if (!turnstileScriptPromise) {
    turnstileScriptPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector(
        'script[data-fruityger-turnstile="true"]'
      );

      if (existingScript) {
        existingScript.addEventListener("load", () => resolve(window.turnstile), {
          once: true,
        });
        existingScript.addEventListener(
          "error",
          () => reject(new Error("Failed to load Turnstile")),
          { once: true }
        );
        return;
      }

      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.fruitygerTurnstile = "true";
      script.onload = () => resolve(window.turnstile);
      script.onerror = () => reject(new Error("Failed to load Turnstile"));
      document.head.appendChild(script);
    }).catch((error) => {
      turnstileScriptPromise = null;
      throw error;
    });
  }

  return turnstileScriptPromise;
};

const TurnstileWidget = forwardRef(function TurnstileWidget({ siteKey }, ref) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const pendingPromiseRef = useRef(null);

  useEffect(() => {
    let disposed = false;

    if (!siteKey || !containerRef.current) {
      return undefined;
    }

    loadTurnstileScript()
      .then((turnstile) => {
        if (disposed || widgetIdRef.current !== null || !containerRef.current) {
          return;
        }

        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          size: "invisible",
          callback: (token) => {
            pendingPromiseRef.current?.resolve(token);
            pendingPromiseRef.current = null;
          },
          "error-callback": () => {
            pendingPromiseRef.current?.reject(
              new Error("Turnstile verification failed")
            );
            pendingPromiseRef.current = null;
          },
          "expired-callback": () => {
            pendingPromiseRef.current?.reject(
              new Error("Turnstile verification expired")
            );
            pendingPromiseRef.current = null;
            turnstile.reset(widgetIdRef.current);
          },
          "timeout-callback": () => {
            pendingPromiseRef.current?.reject(
              new Error("Turnstile verification timed out")
            );
            pendingPromiseRef.current = null;
            turnstile.reset(widgetIdRef.current);
          },
        });
      })
      .catch(() => {
        pendingPromiseRef.current?.reject(new Error("Failed to load Turnstile"));
        pendingPromiseRef.current = null;
      });

    return () => {
      disposed = true;

      if (pendingPromiseRef.current) {
        pendingPromiseRef.current.reject(new Error("Turnstile was cancelled"));
        pendingPromiseRef.current = null;
      }

      if (window.turnstile && widgetIdRef.current !== null) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey]);

  useImperativeHandle(ref, () => ({
    async executeAsync() {
      if (!siteKey) {
        throw new Error("Turnstile site key is missing");
      }

      const turnstile = await loadTurnstileScript();

      if (widgetIdRef.current === null) {
        throw new Error("Turnstile is not ready yet");
      }

      if (pendingPromiseRef.current) {
        pendingPromiseRef.current.reject(new Error("Turnstile verification was replaced"));
        pendingPromiseRef.current = null;
      }

      return new Promise((resolve, reject) => {
        pendingPromiseRef.current = { resolve, reject };
        turnstile.execute(widgetIdRef.current);
      });
    },
    reset() {
      if (window.turnstile && widgetIdRef.current !== null) {
        window.turnstile.reset(widgetIdRef.current);
      }
      pendingPromiseRef.current = null;
    },
  }));

  return <div ref={containerRef} className="turnstile-widget" aria-hidden="true" />;
});

export default TurnstileWidget;
