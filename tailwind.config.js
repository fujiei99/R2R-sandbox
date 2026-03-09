/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // Refined luxury aesthetic based on frontend guidelines
                background: "#fdfbf9",
                foreground: "#1c1917",
                primary: "#1c1917",
                secondary: "#e7e5e4",
                accent: "#d97706",
                muted: "#a8a29e"
            }
        },
    },
    plugins: [],
}
