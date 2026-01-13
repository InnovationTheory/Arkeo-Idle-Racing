/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Bebas Neue'", "system-ui"],
        body: ["'Space Grotesk'", "system-ui"],
        mono: ["'JetBrains Mono'", "monospace"]
      },
      colors: {
        ink: "#1E1E1E",
        slate: "#6B6B6B",
        paper: "#F6EFE8",
        panel: "#FAF6F1",
        accent: "#F26A3D",
        accent2: "#51980c",
        accent3: "#E6B85C",
        warning: "#E45858",
        midnight: "#243447"
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: 0, transform: "translateY(12px)" },
          "100%": { opacity: 1, transform: "translateY(0)" }
        },
        pulseGlow: {
          "0%": { boxShadow: "0 0 0 0 rgba(242, 106, 61, 0.4)" },
          "70%": { boxShadow: "0 0 0 12px rgba(242, 106, 61, 0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(242, 106, 61, 0)" }
        },
        countdownPulse: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.05)" }
        },
        countdownShake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-2px)" },
          "40%": { transform: "translateX(2px)" },
          "60%": { transform: "translateX(-1px)" },
          "80%": { transform: "translateX(1px)" }
        },
        lockFlash: {
          "0%": { transform: "scale(0.98)", opacity: 0.6 },
          "60%": { transform: "scale(1.03)", opacity: 1 },
          "100%": { transform: "scale(1)", opacity: 1 }
        },
        flipIn: {
          "0%": { transform: "rotateX(90deg)", opacity: 0 },
          "100%": { transform: "rotateX(0deg)", opacity: 1 }
        },
        headerShimmer: {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "100% 50%" }
        }
      },
      animation: {
        "fade-up": "fadeUp 0.6s ease-out",
        "pulse-glow": "pulseGlow 2.5s infinite",
        "countdown-pulse": "countdownPulse 1s ease-in-out infinite",
        "countdown-shake": "countdownShake 0.6s ease-in-out infinite",
        "lock-flash": "lockFlash 0.5s ease-out",
        "flip-in": "flipIn 0.5s ease-out",
        "header-shimmer": "headerShimmer 3s ease-in-out infinite"
      }
    }
  },
  plugins: []
};
