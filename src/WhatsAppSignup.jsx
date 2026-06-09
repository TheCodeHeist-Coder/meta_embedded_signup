import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";


const WhatsAppSignup = () => {
    const [sessionInfo, setSessionInfo] = useState(null);
    const [sdkResponse, setSdkResponse] = useState(null);
    const [isCoexistence, setIsCoexistence] = useState(true);
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);


    useEffect(() => {
        // Prevent loading multiple times
        if (window.FB) return;
        


        window.fbAsyncInit = function () {
            console.log("Before FB init")
            window.FB.init({
                appId: "2140782060178223",
                cookie: true,
                xfbml: false,
                version: "v25.0",
            });
            console.log("Facebook SDK initialized");
        };


        const loadSDK = () => {
            if (document.getElementById("facebook-jssdk")) return;


            const script = document.createElement("script");
            script.id = "facebook-jssdk";
            script.src = "https://connect.facebook.net/en_US/sdk.js";
            script.async = true;
            script.defer = true;
            script.crossOrigin = "anonymous";


            document.body.appendChild(script);
        };


        loadSDK();
    }, []);

    const fbLoginCallback = (response) => {
        if (response.authResponse) {
            const code = response.authResponse.code;


            // server logic here like storing code in db and all
            setSessionInfo(code);
            console.log("Authorization Code:", code);
        }


        setSdkResponse(response);
    };


    const launchWhatsAppSignup = () => {
        if (!window.FB) {
            alert("Facebook SDK not loaded yet.");
            return;
        }

        const extras = {
            version: "v4",
            ...(isCoexistence && {
                setup: {},
                featureType: "whatsapp_business_app_onboarding",
                sessionInfoVersion: "3",
            }),
        };

        console.log("Launching signup with extras:", extras);

        window.FB.login(fbLoginCallback, {
            config_id: "1731129688347511",
            response_type: "code",
            override_default_response_type: true,
            extras,
        });
    };


    return (
        <div style={{ padding: "20px", fontFamily: "Helvetica, Arial, sans-serif" }}>
            <label style={{ display: "block", marginBottom: "16px", fontSize: "14px" }}>
                <input
                    type="checkbox"
                    checked={isCoexistence}
                    onChange={(event) => setIsCoexistence(event.target.checked)}
                    style={{ marginRight: "8px" }}
                />
                Enable WhatsApp Business App coexistence onboarding
            </label>

            <button
                onClick={launchWhatsAppSignup}
                style={{
                    backgroundColor: "#1877f2",
                    border: 0,
                    borderRadius: "4px",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: "16px",
                    fontWeight: "bold",
                    height: "40px",
                    padding: "0 24px",
                }}
            >
                {loading ? "Processing..." : "Login with Facebook"}
            </button>

            <p style={{ marginTop: "12px", fontSize: "14px", color: "#333" }}>
                Current mode: <strong>{isCoexistence ? "WhatsApp Business App coexistence" : "Standard embedded signup"}</strong>
            </p>

            <h3>Session Info Response:</h3>
            <pre>{sessionInfo && JSON.stringify(sessionInfo, null, 2)}</pre>


            <h3>SDK Response:</h3>
            <pre>{sdkResponse && JSON.stringify(sdkResponse, null, 2)}</pre>
        </div>
    );
};


export default WhatsAppSignup;

