import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import WhatsAppSignup from "./WhatsAppSignup";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<WhatsAppSignup />} />
      </Routes>
    </Router>
  );
}

export default App;