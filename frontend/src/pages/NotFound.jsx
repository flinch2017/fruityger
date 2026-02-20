import { Link } from "react-router-dom";
import "../css/NotFound.css";

export default function NotFound() {
  return (
    <div className="notfound-page">
      <div className="notfound-card">
        <h1>404</h1>
        <p>Oops! The page you’re looking for does not exist.</p>
        <Link to="/">Go back</Link>
      </div>
    </div>
  );
}