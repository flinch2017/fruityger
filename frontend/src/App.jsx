import "./css/App.css";
import Header from "./components/Header.jsx";
import Feed from "./components/Feed.jsx";

function App() {
  return (
    <>
      <Header />
      <div className="app-container">
        <Feed />
      </div>
    </>
  );
}

export default App;
