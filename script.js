(() => {
  "use strict";
  const RELATIONSHIPS = window.KNOTATION_RELATIONSHIPS;
  const artboard = document.getElementById("artboard");
  const plane = document.querySelector(".notation-plane");
  let transition = null;
  const filmTime = document.getElementById("film-time");
  const gallery = document.getElementById("bracelet-gallery");
  const names = document.getElementById("relationship-list");
  const sectionMenu = document.getElementById("section-menu");
  const toggle = document.getElementById("motion-toggle");
  const status = document.getElementById("motion-status");
  const error = document.getElementById("playback-error");
  let notation = document.getElementById("notation-image");
  let selected = -1, generation = 0, player = null, resumeOnVisible = false;
  const nameButtons = [], cards = [];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const wrap = index => (index % RELATIONSHIPS.length + RELATIONSHIPS.length) % RELATIONSHIPS.length;

  function fitArtboard() {
    const scale = innerWidth / 1920;
    const height = innerHeight / scale;
    const geometry = document.documentElement.style;
    geometry.setProperty("--artboard-scale", String(scale));
    geometry.setProperty("--artboard-height", `${height}px`);
    geometry.setProperty("--notation-scale", String(Math.min(1, height / 1080)));
    // Keep the longest name 10px left of its former right-aligned position.
    const width = Math.max(...nameButtons.map(button => button.firstElementChild.offsetWidth)) + 10;
    names.style.setProperty("--relationship-width", `${width}px`);
    // Center the artwork in the open space between the two text columns.
    const menuRight = sectionMenu.offsetLeft + sectionMenu.offsetWidth;
    const center = (menuRight + names.offsetLeft) / 2 + 8;
    geometry.setProperty("--notation-center-x", `${center}px`);
  }

  function drawTime(seconds) {
    filmTime.textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map(value => String(value).padStart(2, "0")).join(":");
    filmTime.setAttribute("datetime", `PT${seconds}S`);
  }

  function loadImage(filename, relationship) {
    const image = new Image();
    image.className = "notation";
    image.id = "notation-image";
    image.width = 1920; image.height = 1080;
    image.draggable = false; image.decoding = "async";
    image.alt = `${relationship.name} — film notation`;
    image.src = `assets/${encodeURIComponent(filename)}`;
    return image.decode().then(() => image);
  }

  function showImage(image) { notation.replaceWith(image); notation = image; }

  function updateControl(state) {
    const { index, playing, ended, loading } = state;
    toggle.disabled = false;
    toggle.setAttribute("aria-label", playing ? "Pause animation" : ended ? "Replay animation" : "Play animation");
    toggle.setAttribute("aria-pressed", String(playing));
    toggle.title = playing ? "Pause" : ended ? "Replay" : "Play";
    artboard.dataset.playback = ended ? "ended" : playing ? "playing" : index < 0 ? "idle" : "paused";
    artboard.dataset.frame = String(index + 1);
    artboard.setAttribute("aria-busy", String(loading));
    if (playing) error.hidden = true;
    status.textContent = ended ? "Animation finished." : playing ? "Animation playing." : "Animation paused.";
  }

  function positionSelection() {
    const half = Math.floor(RELATIONSHIPS.length / 2);
    const imageStep = parseFloat(getComputedStyle(gallery).width);
    nameButtons.forEach((button, index) => {
      const distance = wrap(index - selected + half) - half;
      const card = cards[index];
      // Recycle the farthest pair at the hidden edge, never through the center.
      const oldDistance = button.dataset.distance;
      const recycled = oldDistance === undefined || Math.abs(distance - Number(oldDistance)) > half;
      if (recycled) {
        button.classList.add("is-repositioning");
        card?.classList.add("is-repositioning");
      }
      button.dataset.distance = String(distance);
      button.style.transform = `translateY(calc(-50% + ${distance * 32}px))`;
      button.style.opacity = distance === 0 ? "1" : String(0.58 * Math.pow(0.60, Math.abs(distance) - 1));
      button.setAttribute("aria-pressed", String(distance === 0));
      if (card) {
        card.dataset.distance = String(distance);
        card.style.transform = `translateY(calc(-50% + ${distance * imageStep}px))`;
        card.style.opacity = distance === 0 ? "1" : String(Math.pow(0.28, Math.abs(distance)));
        card.setAttribute("aria-pressed", String(distance === 0));
        card.tabIndex = Math.abs(distance) <= 1 ? 0 : -1;
      }
      if (recycled) requestAnimationFrame(() => requestAnimationFrame(() => {
        button.classList.remove("is-repositioning");
        card?.classList.remove("is-repositioning");
      }));
    });
  }

  async function selectRelationship(index) {
    index = wrap(index);
    if (index === selected && player) return;
    const version = ++generation;
    player?.pause(); player = null; resumeOnVisible = false;
    selected = index;
    const relationship = RELATIONSHIPS[index];
    const opacity = getComputedStyle(plane).opacity;
    transition?.cancel();
    transition = plane.animate([{ opacity }, { opacity: 0 }], {
      duration: reducedMotion.matches ? 0 : 220, easing: "ease-out", fill: "forwards"
    });
    const faded = transition.finished.catch(() => {});
    artboard.dataset.relationship = relationship.id;
    artboard.dataset.frame = "0";
    artboard.dataset.playback = relationship.frames.length ? "loading" : "unavailable";
    artboard.setAttribute("aria-busy", String(Boolean(relationship.frames.length)));
    positionSelection();
    toggle.disabled = true;
    toggle.setAttribute("aria-pressed", "false");
    toggle.setAttribute("aria-label", "Play animation");
    toggle.title = relationship.frames.length ? "Play" : "Notation coming soon";
    error.hidden = true;
    filmTime.hidden = !relationship.timecodes?.length;
    filmTime.setAttribute("aria-label", "Film timecode");
    drawTime(0);
    const description = document.querySelector(".film-description");
    const paragraph = description.querySelector("p");
    paragraph.replaceChildren();
    const text = (relationship.description || "").replace(/\.\s+/, ".\n");
    for (const part of text.split(/(\(\d{4}\)|\*[^*]+\*)/g)) {
      if (/^\(\d{4}\)$/.test(part)) {
        const year = document.createElement("span");
        year.className = "film-year";
        year.textContent = part;
        paragraph.append(year);
      } else if (part.startsWith("*") && part.endsWith("*")) {
        const title = document.createElement("em");
        title.textContent = part.slice(1, -1);
        paragraph.append(title);
      } else paragraph.append(document.createTextNode(part));
    }
    description.hidden = !relationship.description;
    if (!relationship.cover || !relationship.frames.length) {
      await faded;
      if (version !== generation) return;
      notation.hidden = true;
      status.textContent = `${relationship.name}. Notation coming soon.`;
      return;
    }
    const cache = new Map();
    const loadFrame = frame => {
      if (!cache.has(frame)) {
        const ready = loadImage(relationship.frames[frame], relationship).catch(failure => {
          cache.delete(frame); throw failure;
        });
        cache.set(frame, ready);
      }
      return cache.get(frame);
    };
    try {
      const [cover] = await Promise.all([loadImage(relationship.cover, relationship), faded]);
      if (version !== generation) return;
      artboard.style.setProperty("--artwork-center-x", `${relationship.artworkCenterX ?? 749.75}px`);
      showImage(cover);
      transition?.cancel();
      transition = plane.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: reducedMotion.matches ? 0 : 480, easing: "cubic-bezier(.22,.7,.2,1)", fill: "forwards"
      });
      await transition.finished.catch(() => {});
      if (version !== generation) return;
      player = window.createImageSequencePlayer({
        count: relationship.frames.length,
        interval: 1000,
        loadFrame,
        showFrame: (image, frame) => {
          if (version !== generation) return;
          showImage(image);
          const timecode = relationship.timecodes?.[frame];
          if (timecode) drawTime(timecode.split(":").reduce((total, part) => total * 60 + Number(part), 0));
          for (const key of cache.keys()) if (key !== frame && key !== frame + 1) cache.delete(key);
          if (frame + 1 < relationship.frames.length) loadFrame(frame + 1).catch(() => {});
        },
        onChange: state => { if (version === generation) updateControl(state); },
        onError: () => {
          if (version !== generation) return;
          error.textContent = "이미지를 불러오지 못했어요. 재생 버튼으로 다시 시도해 주세요.";
          error.hidden = false;
        },
      });
      updateControl(player.state());
      loadFrame(0).catch(() => {});
    } catch (failure) {
      if (version !== generation) return;
      artboard.setAttribute("aria-busy", "false");
      error.textContent = "기보를 불러오지 못했어요. 팔찌를 다시 선택해 주세요.";
      error.hidden = false;
    }
  }

  RELATIONSHIPS.forEach((relationship, index) => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "relationship-name";
    const label = document.createElement("span");
    label.textContent = relationship.name;
    button.append(label);
    button.addEventListener("click", () => selectRelationship(index));
    names.append(button); nameButtons.push(button);
    if (!relationship.bracelet) {
      cards.push(null);
      return;
    }
    const card = document.createElement("button");
    card.type = "button"; card.className = "bracelet-card";
    card.setAttribute("aria-label", `Bracelet ${index + 1}: ${relationship.name}`);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.controls = false;
    video.autoplay = false;
    video.tabIndex = -1;
    video.setAttribute("aria-hidden", "true");
    // Seek just inside the first frame so WebKit displays it without playback.
    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(0.001, video.duration || 0);
      video.pause();
    }, { once: true });
    video.addEventListener("play", () => video.pause());
    const videoVersion = relationship.braceletVersion
      ? `?v=${encodeURIComponent(relationship.braceletVersion)}`
      : "";
    video.src = `assets/${encodeURIComponent(relationship.bracelet)}${videoVersion}`;
    card.append(video);
    card.addEventListener("click", () => selectRelationship(index));
    gallery.append(card); cards.push(card);
  });

  const galleryView = window.createBraceletGallery({
    root: document.getElementById("gallery-space"),
    relationships: RELATIONSHIPS.filter(relationship => relationship.bracelet),
    sourceCards: cards.filter(Boolean)
  });
  const themesTab = document.getElementById("themes-tab");
  const galleryTab = document.getElementById("gallery-tab");
  const aboutTab = document.getElementById("about-tab");
  const aboutPage = document.getElementById("about-page");
  // Kick off the About-only scripts on the first navigation to About.
  // Ordered classic scripts also work when opening index.html directly.
  const inkScripts=document.getElementById("about-scripts");
  let inkRequested=false;
  function loadAboutScripts() {
    if(inkRequested)return;
    inkRequested=true;
    for(const source of inkScripts.content.querySelectorAll("script")){
      const script=document.createElement("script");
      script.async=false;
      script.src=source.getAttribute("src");
      script.addEventListener("error",()=>{inkRequested=false;},{once:true});
      document.head.append(script);
    }
  }
  let view = "themes", desiredView = "themes", switchingView = false;
  const themeContent = [...artboard.children];
  const setThemeInteractive = enabled => themeContent.forEach(el => { el.inert = !enabled; });
  function updateNavigation(next) {
    [[themesTab, "themes"], [galleryTab, "gallery"], [aboutTab, "about"]].forEach(([tab, section]) => {
      if (next === section) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
    aboutTab.setAttribute("aria-expanded", String(next === "about"));
  }
  async function showAbout(open, peer) {
    const direct = peer === "gallery";
    artboard.style.visibility = direct ? "hidden" : "visible";
    setThemeInteractive(false);
    aboutPage.inert = !open;
    aboutPage.classList.toggle("via-gallery", direct);
    if (open) {
      aboutPage.hidden = false;
      void aboutPage.offsetHeight;
    }
    artboard.classList.toggle("is-about", open);
    // Keep the About scene in place until the returning black panel covers it.
    const galleryIsCovering = !open && direct;
    if (!galleryIsCovering) aboutPage.classList.toggle("is-visible", open);
    document.body.dataset.view = open ? "about" : peer;
    const layers = direct ? [aboutPage] : [document.querySelector(".theme-notation"), gallery, names,
      filmTime, toggle, document.querySelector(".film-description"), aboutPage];
    const animations = layers.flatMap(el => el.getAnimations({ subtree: el === aboutPage }));
    const transitions = animations.map(animation => animation.finished.catch(() => {}));
    if (direct) {
      const options = { peer: "about" };
      transitions.push(open ? galleryView.exit(options) : galleryView.enter(options));
    }
    await Promise.all(transitions);
    aboutPage.hidden = !open;
    if (galleryIsCovering) aboutPage.classList.remove("is-visible");
    setThemeInteractive(!open && !direct);
  }
  async function changeView(next, { immediate = false } = {}) {
    desiredView = next;
    if(next==="about")loadAboutScripts();
    updateNavigation(next);
    if (switchingView) return;
    switchingView = true;
    try {
      while (view !== desiredView) {
        const target = desiredView;
        player?.pause(); resumeOnVisible = false;
        if (target === "about" || view === "about") {
          const opening = target === "about";
          await showAbout(opening, opening ? view : target);
        } else if (target === "gallery") {
          const entering = galleryView.enter({ immediate });
          immediate = false;
          document.body.dataset.view = "gallery";
          setThemeInteractive(false);
          await entering;
          artboard.style.visibility = "hidden";
        } else {
          artboard.style.visibility = "visible";
          document.body.dataset.view = "themes";
          await galleryView.exit();
          setThemeInteractive(true);
        }
        view = target;
      }
    } finally { switchingView = false; }
  }
  themesTab.addEventListener("click", () => changeView("themes"));
  galleryTab.addEventListener("click", () => changeView("gallery"));
  aboutTab.addEventListener("click", () => changeView(desiredView === "about" ? "themes" : "about"));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && desiredView !== "themes") { changeView("themes"); themesTab.focus(); }
  });

  let lastWheel = -Infinity;
  [names, gallery].forEach(container => {
    container.addEventListener("wheel", event => {
      event.preventDefault();
      if (Math.abs(event.deltaY) < 15 || performance.now() - lastWheel < 400) return;
      lastWheel = performance.now();
      selectRelationship(selected + Math.sign(event.deltaY));
    }, { passive: false });
    container.addEventListener("keydown", event => {
      if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? RELATIONSHIPS.length - 1 :
        wrap(selected + (event.key === "ArrowDown" ? 1 : -1));
      selectRelationship(next); nameButtons[next].focus({ preventScroll: true });
    });
  });
  toggle.addEventListener("click", () => player?.toggle());
  document.addEventListener("keydown", event => {
    if (desiredView !== "themes" || switchingView) return;
    if (event.code !== "Space" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.closest("button, a, input, textarea, select, [contenteditable]")) return;
    event.preventDefault(); player?.toggle();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { resumeOnVisible = Boolean(player?.state().playing); player?.pause(); }
    else if (resumeOnVisible) { resumeOnVisible = false; player?.play(); }
  });
  reducedMotion.addEventListener("change", event => { if (event.matches) { resumeOnVisible = false; player?.pause(); } });
  window.addEventListener("resize", fitArtboard);
  fitArtboard();
  selectRelationship(RELATIONSHIPS.findIndex(relationship => relationship.id === "bracelet6"));
  changeView("gallery", { immediate: true });
  document.fonts.ready.then(fitArtboard);
})();
