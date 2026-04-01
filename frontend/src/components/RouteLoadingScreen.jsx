export default function RouteLoadingScreen() {
  return (
    <div className="route-loading-shell">
      <div className="route-loading-card">
        <div className="route-loading-backdrop" aria-hidden="true">
          <span className="route-loading-bubble route-loading-bubble-a"></span>
          <span className="route-loading-bubble route-loading-bubble-b"></span>
          <span className="route-loading-bubble route-loading-bubble-c"></span>
          <span className="route-loading-bubble route-loading-bubble-d"></span>
          <span className="route-loading-cloud route-loading-cloud-a"></span>
          <span className="route-loading-cloud route-loading-cloud-b"></span>
        </div>

        <div className="route-loading-mascot" aria-hidden="true">
          <div className="route-loading-mascot-shadow"></div>
          <div className="route-loading-mascot-body">
            <div className="route-loading-mascot-highlight"></div>
            <div className="route-loading-mascot-cheeks">
              <span></span>
              <span></span>
            </div>
            <div className="route-loading-mascot-face">
              <span className="route-loading-mascot-eye"></span>
              <span className="route-loading-mascot-eye"></span>
            </div>
            <div className="route-loading-mascot-smile"></div>
            <div className="route-loading-mascot-spark route-loading-mascot-spark-a"></div>
            <div className="route-loading-mascot-spark route-loading-mascot-spark-b"></div>
          </div>
        </div>

        <div className="route-loading-copy">
          <p className="route-loading-title">Loading Fruityger...</p>
          <p className="route-loading-subtitle">
            Our little aero buddy is fluffing the clouds and polishing the glass.
          </p>
        </div>
      </div>
    </div>
  );
}
