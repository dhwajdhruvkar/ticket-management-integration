"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { apiGet } from "@/lib/api";
import type { RequesterChoice, RequesterSearchResult } from "@/server/services/requesterSearch";

// Searchable combobox over the organization's active users. Free email entry still
// works; typing a value without choosing a person sends onSelect(null).
export function RequesterPicker({
  value,
  onChange,
  disabled,
  onSelect,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  onSelect?: (choice: RequesterChoice | null) => void;
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const helpId = `${uid}-help`;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RequesterChoice[]>([]);
  const [active, setActive] = useState(-1);
  const [state, setState] = useState("");
  const showList = open && !disabled && items.length > 0;

  useEffect(() => {
    if (disabled || !open) return;
    let live = true;
    const timer = setTimeout(() => {
      setState("Searching organization users…");
      apiGet<RequesterSearchResult>(`/requesters?q=${encodeURIComponent(value.trim())}`).then((data) => {
        if (!live) return;
        setItems(data.items);
        setActive(-1);
        setState(data.items.length === 0 ? "No matching users. You can enter a new email." : data.hasMore ? "More matches available; refine your search." : "");
      }).catch(() => {
        if (!live) return;
        setItems([]);
        setActive(-1);
        setState("Search unavailable. You can still enter a valid email.");
      });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [value, open, disabled]);

  function choose(choice: RequesterChoice) {
    onChange(choice.email);
    onSelect?.(choice);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && showList && active >= 0) {
      event.preventDefault();
      choose(items[active]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    } else if (event.key === "Tab") {
      setOpen(false);
      setActive(-1);
    }
  }

  return <div>
    <label className="label" htmlFor={uid}>Requester (who)</label>
    <input
      id={uid}
      className="input"
      type="text"
      role="combobox"
      autoComplete="off"
      aria-autocomplete="list"
      aria-expanded={showList}
      aria-controls={listId}
      aria-activedescendant={showList && active >= 0 ? `${uid}-opt-${active}` : undefined}
      aria-describedby={helpId}
      value={value}
      disabled={disabled}
      placeholder="Search name, email, department or location — or enter a new email"
      onFocus={() => setOpen(true)}
      onBlur={() => { setOpen(false); setActive(-1); }}
      onKeyDown={onKeyDown}
      onChange={(event) => {
        onChange(event.target.value);
        onSelect?.(null);
        setOpen(true);
      }}
    />
    <ul id={listId} role="listbox" aria-label="Organization users" hidden={!showList} style={{ listStyle: "none", margin: "4px 0 0", padding: 4, border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", maxHeight: 260, overflowY: "auto" }}>
      {items.map((user, index) => {
        const detail = [user.department, user.location].filter(Boolean).join(" · ");
        return <li
          key={user.id}
          id={`${uid}-opt-${index}`}
          role="option"
          aria-selected={index === active}
          onMouseDown={(event) => { event.preventDefault(); choose(user); }}
          onMouseEnter={() => setActive(index)}
          style={{ padding: "0.45rem 0.6rem", borderRadius: 6, cursor: "pointer", background: index === active ? "var(--brand-50)" : undefined }}
        >
          <div style={{ fontSize: "0.86rem", fontWeight: 600 }}>{user.name} <span className="muted" style={{ fontWeight: 400 }}>— {user.email}</span></div>
          {detail ? <div className="muted" style={{ fontSize: "0.74rem" }}>{detail}</div> : null}
        </li>;
      })}
    </ul>
    <p id={helpId} className="muted" style={{ fontSize: "0.74rem", marginTop: 4 }} role="status">
      {disabled ? "Requests are submitted as your signed-in account." : state || "Select an organization user or enter a new email. No login account is created."}
    </p>
  </div>;
}
