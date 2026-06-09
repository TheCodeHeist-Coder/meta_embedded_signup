import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import WhatsAppSignup from "./WhatsAppSignup";
import PrivacyPolicy from "./PrivacyPolicy";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<WhatsAppSignup />} />
        <Route path="/policies" element={<PrivacyPolicy />} />
      </Routes>
    </Router>
  );
}

export default App;