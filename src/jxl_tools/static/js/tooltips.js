((app) => {
  "use strict";

  let tooltipEl = null;
  let activeTarget = null;

  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement("div");
    tooltipEl.className = "app-tooltip";
    tooltipEl.setAttribute("aria-hidden", "true");
    tooltipEl.style.display = "none";
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function primeTooltips(root = document) {
    if (!root) return;

    if (root instanceof Element && root.hasAttribute("title")) {
      const title = root.getAttribute("title");
      if (title) {
        root.dataset.tooltip = title;
        root.removeAttribute("title");
      }
    }

    if (!root.querySelectorAll) return;
    root.querySelectorAll("[title]").forEach((element) => {
      const title = element.getAttribute("title");
      if (!title) return;
      element.dataset.tooltip = title;
      element.removeAttribute("title");
    });
  }

  function getTooltipTarget(node) {
    return node?.closest?.("[data-tooltip]") || null;
  }

  function positionTooltip(event) {
    if (!activeTarget || !tooltipEl) return;

    const margin = 14;
    let x = margin;
    let y = margin;

    if (event) {
      x = event.clientX + 16;
      y = event.clientY + 18;
    } else {
      const rect = activeTarget.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top - 12;
    }

    const maxX = window.innerWidth - tooltipEl.offsetWidth - margin;
    const maxY = window.innerHeight - tooltipEl.offsetHeight - margin;
    const nextX = Math.max(margin, Math.min(x, maxX));
    let nextY = Math.max(margin, Math.min(y, maxY));

    if (event && nextY === maxY) {
      nextY = Math.max(margin, event.clientY - tooltipEl.offsetHeight - 12);
    }

    tooltipEl.style.transform = `translate(${Math.round(nextX)}px, ${Math.round(nextY)}px)`;
  }

  function showTooltip(target, event) {
    const text = target?.dataset?.tooltip;
    if (!text) return;

    const tooltip = ensureTooltip();
    activeTarget = target;
    tooltip.textContent = text;
    tooltip.style.display = "block";
    tooltip.setAttribute("aria-hidden", "false");
    positionTooltip(event);
  }

  function hideTooltip() {
    activeTarget = null;
    if (tooltipEl) {
      tooltipEl.style.display = "none";
      tooltipEl.setAttribute("aria-hidden", "true");
    }
  }

  function initTooltips() {
    primeTooltips(document);
    ensureTooltip();

    document.addEventListener("pointerover", (event) => {
      const target = getTooltipTarget(event.target);
      if (!target) {
        hideTooltip();
        return;
      }
      if (target !== activeTarget) {
        showTooltip(target, event);
      } else {
        positionTooltip(event);
      }
    });

    document.addEventListener("pointermove", (event) => {
      if (activeTarget) {
        positionTooltip(event);
      }
    });

    document.addEventListener("pointerout", (event) => {
      if (!activeTarget) return;
      const leaving = getTooltipTarget(event.target);
      const entering = getTooltipTarget(event.relatedTarget);
      if (leaving === activeTarget && entering !== activeTarget) {
        hideTooltip();
      }
    });

    document.addEventListener("focusin", (event) => {
      const target = getTooltipTarget(event.target);
      if (target) {
        showTooltip(target);
      }
    });

    document.addEventListener("focusout", (event) => {
      if (event.target === activeTarget || getTooltipTarget(event.target) === activeTarget) {
        hideTooltip();
      }
    });

    window.addEventListener("scroll", () => {
      if (activeTarget) {
        positionTooltip();
      }
    }, true);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes" && mutation.target instanceof Element) {
          primeTooltips(mutation.target);
          return;
        }

        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            primeTooltips(node);
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["title"],
    });
  }

  app.tooltips = {
    initTooltips,
    primeTooltips,
  };
})(window.JXLApp);
