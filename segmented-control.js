/* Shared behavior for the extension's two-option segmented switches. */
var YTD_SEGMENTED_CONTROL = (() => {
  const CONTROL_SELECTOR = "[data-segmented-control]";
  const OPTION_SELECTOR = ".segmented-control__option";

  function getOptions(control) {
    return control ? [...control.querySelectorAll(OPTION_SELECTOR)] : [];
  }

  function updateIndicator(control) {
    const selected = getOptions(control).find(
      (option) => option.getAttribute("aria-pressed") === "true",
    );
    if (!selected) return;
    control.style.setProperty("--segmented-control-indicator-left", `${selected.offsetLeft}px`);
    control.style.setProperty("--segmented-control-indicator-width", `${selected.offsetWidth}px`);
  }

  function select(control, selectedOption) {
    const options = getOptions(control);
    const selected = typeof selectedOption === "string"
      ? options.find((option) => option.dataset.segmentedValue === selectedOption)
      : selectedOption;
    if (!selected || !options.includes(selected)) return false;
    for (const option of options) option.setAttribute("aria-pressed", String(option === selected));
    updateIndicator(control);
    return true;
  }

  function initialize(root = document) {
    for (const control of root.querySelectorAll(CONTROL_SELECTOR)) {
      if (control.dataset.segmentedControlReady === "true") continue;
      control.dataset.segmentedControlReady = "true";
      const options = getOptions(control);
      const selected = options.find((option) => option.getAttribute("aria-pressed") === "true") || options[0];
      if (selected) select(control, selected);
      control.addEventListener("click", (event) => {
        const option = event.target.closest(OPTION_SELECTOR);
        if (option && control.contains(option)) select(control, option);
      });
      control.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const currentIndex = options.indexOf(event.target);
        if (currentIndex === -1) return;
        event.preventDefault();
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
        options[nextIndex].focus();
        options[nextIndex].click();
      });
      new ResizeObserver(() => updateIndicator(control)).observe(control);
    }
  }

  return { initialize, select, updateIndicator };
})();
