/**
 * Chief's standalone light/dark theme manager.
 * Uses the same "theme" localStorage key as One-Time Secret.
 */
export class ThemeController {
    static STORAGE_KEY = "theme";

    constructor(button, translator) {
        this.button = button;
        this.translator = translator;
    }

    init() {
        this.apply(this.readStoredTheme());

        if (this.button) {
            this.button.addEventListener("click", () => {
                const next = document.documentElement.classList.contains("dark")
                    ? "light"
                    : "dark";

                this.apply(next);

                try {
                    localStorage.setItem(ThemeController.STORAGE_KEY, next);
                } catch {
                    // The visual theme still works if browser storage is disabled.
                }
            });
        }
    }

    readStoredTheme() {
        try {
            return localStorage.getItem(ThemeController.STORAGE_KEY) === "dark"
                ? "dark"
                : "light";
        } catch {
            return "light";
        }
    }

    apply(theme) {
        const dark = theme === "dark";

        document.documentElement.classList.toggle("dark", dark);
        document.body.classList.toggle("dark", dark);

        if (this.button) {
            const label = this.translator.t(dark ? "app.theme.dark" : "app.theme.light");
            const action = this.translator.t(
                dark ? "app.theme.switchToLight" : "app.theme.switchToDark"
            );

            this.button.querySelector(".toggle-label").textContent = label;
            this.button.setAttribute("aria-label", action);
            this.button.setAttribute("title", action);
            this.button.setAttribute("aria-pressed", String(dark));
        }

        const meta = document.querySelector('meta[name="theme-color"]');

        if (meta) {
            meta.setAttribute("content", dark ? "#111d18" : "#f5f4ed");
        }
    }
}
