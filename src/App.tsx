import { useEffect, useRef, useState } from "react";
import { addImage, deleteImage, load, saveBrief, saveCaps } from "./db";
import { Wordmark } from "./logo";
import {
  CATEGORIES,
  METALS,
  categoryById,
  emptyBrief,
  fitSlots,
  metalLabel,
  type Brief,
  type Caps,
  type CategoryId,
  type ImageRecord,
  type MetalId,
} from "./types";

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash || "#/");
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

function gapSentence(gaps: string[]): string {
  if (gaps.length === 0) return "";
  if (gaps.length === 1) return `Add ${gaps[0]} before this can lock.`;
  const last = gaps[gaps.length - 1];
  return `Add ${gaps.slice(0, -1).join(", ")} and ${last} before this can lock.`;
}

function gapsFor(brief: Brief): string[] {
  const gaps: string[] = [];
  if (!brief.clientName.trim()) gaps.push("your name");
  if (!brief.metal) gaps.push("a metal colour");
  return gaps;
}

function formatWhen(stamp: number): string {
  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(stamp);
}

export function App() {
  const hash = useHash();
  const view = hash.startsWith("#/studio") ? "studio" : "client";
  const [ready, setReady] = useState(false);
  const [caps, setCaps] = useState<Caps | null>(null);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [openBriefId, setOpenBriefId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const briefRef = useRef<Brief | null>(null);
  const capsRef = useRef<Caps | null>(null);
  const imagesRef = useRef<ImageRecord[]>([]);
  briefRef.current = brief;
  capsRef.current = caps;
  imagesRef.current = images;

  useEffect(() => {
    let cancel = false;
    load().then((state) => {
      if (cancel) return;
      setCaps(state.caps);
      setImages(state.images);
      setBriefs(state.briefs);
      setBrief(state.brief);
      setReady(true);
    });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const image of images) next[image.id] = URL.createObjectURL(image.blob);
    setUrls(next);
    return () => {
      for (const url of Object.values(next)) URL.revokeObjectURL(url);
    };
  }, [images]);

  function commit(next: Brief) {
    briefRef.current = next;
    setBrief(next);
    setBriefs((current) => {
      const without = current.filter((item) => item.id !== next.id);
      return [...without, next];
    });
    void saveBrief(next);
  }

  async function discardClientImage(id: string | null) {
    if (!id) return;
    const image = imagesRef.current.find((item) => item.id === id);
    if (!image || image.origin !== "client") return;
    await deleteImage(id);
    setImages((prev) => prev.filter((item) => item.id !== id));
  }

  function placeLibrary(category: CategoryId, imageId: string) {
    const current = briefRef.current;
    const cap = capsRef.current?.[category];
    if (!current || current.status !== "draft" || cap === undefined) return;
    const slots = fitSlots(current.selections[category], cap);
    const existing = slots.indexOf(imageId);
    if (existing >= 0) {
      slots[existing] = null;
      commit({
        ...current,
        selections: { ...current.selections, [category]: slots },
      });
      return;
    }
    const empty = slots.indexOf(null);
    if (empty < 0) return;
    slots[empty] = imageId;
    commit({
      ...current,
      selections: { ...current.selections, [category]: slots },
    });
  }

  function clearSlot(category: CategoryId, index: number) {
    const current = briefRef.current;
    const cap = capsRef.current?.[category];
    if (!current || current.status !== "draft" || cap === undefined) return;
    const slots = fitSlots(current.selections[category], cap);
    const previous = slots[index] ?? null;
    if (!previous) return;
    slots[index] = null;
    commit({
      ...current,
      selections: { ...current.selections, [category]: slots },
    });
    void discardClientImage(previous);
  }

  async function onFile(category: CategoryId, index: number, input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    const current = briefRef.current;
    const cap = capsRef.current?.[category];
    if (!file || !current || current.status !== "draft" || cap === undefined) return;
    if (!file.type.startsWith("image/")) return;
    if (index < 0 || index >= cap) return;
    const image: ImageRecord = {
      id: crypto.randomUUID(),
      categoryId: category,
      origin: "client",
      briefId: current.id,
      name: file.name.replace(/\.[^.]+$/, "") || "Your reference",
      mime: file.type || "image/png",
      blob: file,
      hidden: false,
      createdAt: Date.now(),
    };
    await addImage(image);
    const latest = briefRef.current;
    const latestCap = capsRef.current?.[category] ?? cap;
    if (!latest || latest.id !== current.id || latest.status !== "draft" || index >= latestCap) {
      await deleteImage(image.id);
      return;
    }
    const slots = fitSlots(latest.selections[category], latestCap);
    const previous = slots[index] ?? null;
    slots[index] = image.id;
    setImages((prev) => [...prev, image]);
    commit({
      ...latest,
      selections: { ...latest.selections, [category]: slots },
    });
    if (previous) void discardClientImage(previous);
  }

  function lock() {
    const current = briefRef.current;
    if (!current || current.status !== "draft") return;
    const gaps = gapsFor(current);
    if (gaps.length) {
      setMessage(gapSentence(gaps));
      return;
    }
    setMessage("");
    commit({ ...current, status: "locked", lockedAt: Date.now() });
  }

  async function startAnother() {
    const created = emptyBrief();
    await saveBrief(created);
    commit(created);
    setMessage("");
  }

  async function changeCap(category: CategoryId, value: string) {
    const currentCaps = capsRef.current;
    const current = briefRef.current;
    if (!currentCaps) return;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;
    const nextCap = Math.min(12, Math.max(1, parsed));
    const nextCaps = { ...currentCaps, [category]: nextCap };
    capsRef.current = nextCaps;
    setCaps(nextCaps);
    void saveCaps(nextCaps);
    if (current && current.status === "draft") {
      const previous = fitSlots(current.selections[category], currentCaps[category]);
      const nextSlots = fitSlots(previous, nextCap);
      const dropped = previous.slice(nextCap).filter((id): id is string => Boolean(id));
      commit({
        ...current,
        selections: { ...current.selections, [category]: nextSlots },
      });
      for (const id of dropped) void discardClientImage(id);
    }
  }

  async function addLibraryFile(category: CategoryId, input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    const image: ImageRecord = {
      id: crypto.randomUUID(),
      categoryId: category,
      origin: "library",
      briefId: null,
      name: file.name.replace(/\.[^.]+$/, "") || "Reference",
      mime: file.type || "image/png",
      blob: file,
      hidden: false,
      createdAt: Date.now(),
    };
    await addImage(image);
    setImages((prev) => [...prev, image]);
  }

  async function removeLibrary(id: string) {
    const usedByLocked = briefs.some(
      (item) =>
        item.status === "locked" &&
        Object.values(item.selections).some((ids) => ids.includes(id)),
    );
    if (usedByLocked) {
      setImages((prev) =>
        prev.map((image) => (image.id === id ? { ...image, hidden: true } : image)),
      );
      const image = images.find((item) => item.id === id);
      if (image) await addImage({ ...image, hidden: true });
    } else {
      await deleteImage(id);
      setImages((prev) => prev.filter((image) => image.id !== id));
    }
    const current = briefRef.current;
    if (current?.status === "draft") {
      const selections = { ...current.selections };
      for (const category of CATEGORIES) {
        selections[category.id] = selections[category.id].filter((imageId) => imageId !== id);
      }
      commit({ ...current, selections });
    }
  }

  if (!ready || !caps || !brief) {
    return (
      <div className="shell">
        <p className="local">Local prototype. Saved in this browser only.</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="header">
        <a className="brand" href="#/" aria-label="Four Words">
          <Wordmark />
        </a>
        <nav className="nav">
          <a href="#/" aria-current={view === "client" ? "page" : undefined}>
            The brief
          </a>
          <a href="#/studio" aria-current={view === "studio" ? "page" : undefined}>
            Library
          </a>
        </nav>
      </header>
      <p className="local">Local prototype. Saved in this browser only.</p>
      {view === "studio" ? (
        <Studio
          caps={caps}
          images={images}
          urls={urls}
          briefs={briefs}
          openBriefId={openBriefId}
          onOpen={setOpenBriefId}
          onCap={changeCap}
          onAdd={addLibraryFile}
          onRemove={removeLibrary}
        />
      ) : (
        <Client
          brief={brief}
          caps={caps}
          images={images}
          urls={urls}
          message={message}
          onName={(clientName) => commit({ ...briefRef.current!, clientName })}
          onMetal={(metal) => commit({ ...briefRef.current!, metal })}
          onFile={onFile}
          onPlace={placeLibrary}
          onClear={clearSlot}
          onLock={lock}
          onStart={startAnother}
        />
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg className="upload-icon" viewBox="0 0 48 48" aria-hidden="true">
      <rect x="7" y="11" width="34" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 29 L16 22 L23 27 L31 18 L41 28" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="16" cy="18" r="2" fill="currentColor" />
    </svg>
  );
}

function Client({
  brief,
  caps,
  images,
  urls,
  message,
  onName,
  onMetal,
  onFile,
  onPlace,
  onClear,
  onLock,
  onStart,
}: {
  brief: Brief;
  caps: Caps;
  images: ImageRecord[];
  urls: Record<string, string>;
  message: string;
  onName: (value: string) => void;
  onMetal: (metal: MetalId) => void;
  onFile: (category: CategoryId, index: number, input: HTMLInputElement) => void;
  onPlace: (category: CategoryId, imageId: string) => void;
  onClear: (category: CategoryId, index: number) => void;
  onLock: () => void;
  onStart: () => void;
}) {
  const [browsing, setBrowsing] = useState<CategoryId | null>(null);

  if (brief.status === "locked") {
    return (
      <main>
        <div className="intro">
          <p className="kicker">This brief is locked</p>
          <h1>{brief.clientName}</h1>
          <p className="deck">We'll design from this set.</p>
          <button className="linkish" type="button" onClick={onStart} style={{ marginTop: 22 }}>
            Start another brief
          </button>
        </div>
        <BriefRead brief={brief} images={images} urls={urls} caps={caps} />
      </main>
    );
  }

  return (
    <main>
      <div className="intro">
        <h1>Show us what to keep.</h1>
        <p className="deck">You don't have to have it all figured out.</p>
        <p className="deck">
          Click a slot to add your own photograph, or choose one from our design library.
        </p>
        <label className="field">
          <span>Your name</span>
          <input
            value={brief.clientName}
            onChange={(event) => onName(event.target.value)}
            autoComplete="name"
          />
        </label>
      </div>
      {CATEGORIES.map((category) => {
        const slots = fitSlots(brief.selections[category.id], caps[category.id]);
        const filled = slots.filter(Boolean).length;
        const full = filled >= caps[category.id];
        const library = images.filter(
          (image) => image.categoryId === category.id && image.origin === "library" && !image.hidden,
        );
        return (
          <section key={category.id} aria-labelledby={`heading-${category.id}`}>
            <hr className="rule" />
            <div className="cat-head">
              <h2 id={`heading-${category.id}`}>{category.name}</h2>
              <p className={full ? "count full" : "count"} id={`count-${category.id}`}>
                {filled} of {caps[category.id]}
              </p>
            </div>
            <p className="prompt">{category.prompt}</p>
            <div className="slots">
              {slots.map((imageId, index) => {
                const image = imageId ? images.find((item) => item.id === imageId) : undefined;
                if (!image) {
                  return (
                    <label key={index} className="upload-slot">
                      <input
                        className="file"
                        type="file"
                        accept="image/*"
                        aria-label={`Upload image to ${category.name}, slot ${index + 1}`}
                        onChange={(event) => onFile(category.id, index, event.currentTarget)}
                      />
                      <span className="upload-frame">
                        <UploadIcon />
                      </span>
                      <span className="caption">Upload image</span>
                    </label>
                  );
                }
                return (
                  <div key={index} className="slot">
                    <div className="frame">
                      {urls[image.id] ? <img src={urls[image.id]} alt="" /> : null}
                    </div>
                    <span className="caption">
                      {image.origin === "client" ? <span className="eyebrow">Yours</span> : null}
                      {image.name}
                    </span>
                    <button className="remove" type="button" onClick={() => onClear(category.id, index)}>
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="row-actions">
              <button
                className="linkish"
                type="button"
                aria-expanded={browsing === category.id}
                onClick={() => setBrowsing(browsing === category.id ? null : category.id)}
              >
                Browse our Existing Design Library
              </button>
              {full ? <p className="full">This part is full. Remove one to add another.</p> : null}
            </div>
            {browsing === category.id ? (
              <div className="library-browse">
                {library.length === 0 ? (
                  <p className="empty">Nothing in the library for this yet.</p>
                ) : (
                  <div className="grid">
                    {library.map((image) => {
                      const selected = slots.includes(image.id);
                      return (
                        <button
                          key={image.id}
                          type="button"
                          className={selected ? "tile selected" : "tile"}
                          aria-pressed={selected}
                          onClick={() => onPlace(category.id, image.id)}
                        >
                          <div className="frame">
                            {urls[image.id] ? <img src={urls[image.id]} alt="" /> : null}
                          </div>
                          <span className="caption">{image.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}
          </section>
        );
      })}
      <section>
        <hr className="rule" />
        <h2>Metal</h2>
        <p className="prompt">One colour for the piece.</p>
        <div className="metals" role="group" aria-label="Metal colour">
          {METALS.map((metal) => (
            <button
              key={metal.id}
              type="button"
              aria-pressed={brief.metal === metal.id}
              onClick={() => onMetal(metal.id)}
            >
              {metal.label}
            </button>
          ))}
        </div>
        <div className="submit-row">
          <button className="linkish" type="button" onClick={onLock}>
            Lock this brief
          </button>
          {message ? (
            <p className="gap" role="status">
              {message}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function BriefRead({
  brief,
  images,
  urls,
  caps,
}: {
  brief: Brief;
  images: ImageRecord[];
  urls: Record<string, string>;
  caps: Caps;
}) {
  return (
    <div>
      <hr className="rule" />
      <h2>Metal</h2>
      <p className="locked-metal">{metalLabel(brief.metal)}</p>
      {CATEGORIES.map((category) => {
        const chosen = fitSlots(brief.selections[category.id], caps[category.id])
          .map((id) => images.find((image) => image.id === id))
          .filter((image): image is ImageRecord => Boolean(image));
        return (
          <section key={category.id}>
            <hr className="rule" />
            <div className="cat-head">
              <h2>{category.name}</h2>
              <p className="count">{chosen.length} kept</p>
            </div>
            <div className="slots">
              {chosen.map((image) => (
                <figure key={image.id} className="slot">
                  <div className="frame">
                    {urls[image.id] ? <img src={urls[image.id]} alt="" /> : null}
                  </div>
                  <span className="caption">
                    {image.origin === "client" ? <span className="eyebrow">Yours</span> : null}
                    {image.name}
                  </span>
                </figure>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Studio({
  caps,
  images,
  urls,
  briefs,
  openBriefId,
  onOpen,
  onCap,
  onAdd,
  onRemove,
}: {
  caps: Caps;
  images: ImageRecord[];
  urls: Record<string, string>;
  briefs: Brief[];
  openBriefId: string | null;
  onOpen: (id: string | null) => void;
  onCap: (category: CategoryId, value: string) => void;
  onAdd: (category: CategoryId, input: HTMLInputElement) => void;
  onRemove: (id: string) => void;
}) {
  const [uploadCategory, setUploadCategory] = useState<CategoryId>("stone");
  const locked = briefs
    .filter((brief) => brief.status === "locked")
    .sort((a, b) => (b.lockedAt ?? 0) - (a.lockedAt ?? 0));
  const open = locked.find((brief) => brief.id === openBriefId) ?? null;

  return (
    <main>
      <div className="intro">
        <h1>The library.</h1>
        <p className="studio-lead">
          Add the references a client can choose from, and set how many photographs each part of
          the ring will hold.
        </p>
      </div>
      <hr className="rule" />
      <h2>How many they can keep</h2>
      <div className="caps">
        {CATEGORIES.map((category) => (
          <label key={category.id} className="cap">
            <span className="cap-label">{category.name}</span>
            <input
              aria-label={`Cap for ${category.name}`}
              type="number"
              min={1}
              max={12}
              value={caps[category.id]}
              onChange={(event) => onCap(category.id, event.target.value)}
            />
          </label>
        ))}
      </div>
      <hr className="rule" />
      <h2>Add a photograph</h2>
      <div className="metals" role="group" aria-label="Library category">
        {CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            aria-pressed={uploadCategory === category.id}
            onClick={() => setUploadCategory(category.id)}
          >
            {category.name}
          </button>
        ))}
      </div>
      <div className="row-actions">
        <label className="linkish" htmlFor="library-upload">
          Add to {categoryById(uploadCategory).name}
        </label>
        <input
          id="library-upload"
          className="file"
          type="file"
          accept="image/*"
          onChange={(event) => onAdd(uploadCategory, event.currentTarget)}
        />
      </div>
      {CATEGORIES.map((category) => {
        const tiles = images.filter(
          (image) => image.origin === "library" && !image.hidden && image.categoryId === category.id,
        );
        return (
          <section key={category.id} className="library-block">
            <hr className="rule" />
            <h2>{category.name}</h2>
            {tiles.length === 0 ? <p className="empty">Nothing in here yet.</p> : null}
            <div className="grid spaced">
              {tiles.map((image) => (
                <div key={image.id}>
                  <div className="frame">
                    {urls[image.id] ? <img src={urls[image.id]} alt="" /> : null}
                  </div>
                  <p className="caption">{image.name}</p>
                  <button className="remove" type="button" onClick={() => onRemove(image.id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <hr className="rule" />
      <h2>Locked briefs</h2>
      {locked.length === 0 ? <p className="empty">Locked briefs will show up here.</p> : null}
      <div className="brief-list">
        {locked.map((brief) => (
          <button
            key={brief.id}
            className="brief-link"
            type="button"
            aria-expanded={openBriefId === brief.id}
            onClick={() => onOpen(openBriefId === brief.id ? null : brief.id)}
          >
            <strong>{brief.clientName}</strong>
            <span className="meta">
              {metalLabel(brief.metal)}
              {brief.lockedAt ? ` · ${formatWhen(brief.lockedAt)}` : ""}
            </span>
          </button>
        ))}
      </div>
      {open ? <BriefRead brief={open} images={images} urls={urls} caps={caps} /> : null}
    </main>
  );
}
