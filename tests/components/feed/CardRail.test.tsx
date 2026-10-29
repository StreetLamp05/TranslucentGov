// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CardRail from "../../../components/feed/CardRail";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PublicReport } from "../../../convex/lib/publicReport";
import type { Owner } from "../../../server/lib/routing";

// A tiny stand-in for Convex's client query store, so the card's real optimistic update runs
// against it: useQuery reads from it, and the mutation applies the update before the server
// call (`server`) resolves.
type Entry = { name: string; args: Record<string, unknown>; value: unknown };
const store = vi.hoisted(() => ({
  entries: [] as { name: string; args: Record<string, unknown>; value: unknown }[],
  listeners: new Set<() => void>(),
  version: 0,
  server: (async () => ({ added: true })) as (args: unknown) => Promise<unknown>,
}));
const keyOf = (args: unknown) => JSON.stringify(args);
const find = (name: string, args: unknown) => store.entries.find((e) => e.name === name && keyOf(e.args) === keyOf(args));
function set(name: string, args: Record<string, unknown>, value: unknown) {
  const entry = find(name, args);
  if (entry) entry.value = value;
  else store.entries.push({ name, args, value });
  store.version++;
  store.listeners.forEach((l) => l());
}

vi.mock("convex/react", () => {
  const subscribe = (l: () => void) => {
    store.listeners.add(l);
    return () => store.listeners.delete(l);
  };
  const localStore = {
    getQuery: (ref: never, args: unknown) => find(getFunctionName(ref), args ?? {})?.value,
    setQuery: (ref: never, args: Record<string, unknown>, value: unknown) => set(getFunctionName(ref), args, value),
    getAllQueries: (ref: never) => store.entries.filter((e: Entry) => e.name === getFunctionName(ref)),
  };
  return {
    useQuery: (ref: never, args: unknown) => {
      useSyncExternalStore(subscribe, () => store.version);
      return args === "skip" ? undefined : find(getFunctionName(ref), args)?.value;
    },
    useMutation: () => ({
      withOptimisticUpdate: (update: (s: typeof localStore, args: unknown) => void) => async (args: unknown) => {
        const before = store.entries.map((e: Entry) => ({ ...e }));
        update(localStore, args);
        try {
          return await store.server(args);
        } catch (err) {
          store.entries = before; // Convex rolls the optimistic update back on failure
          store.version++;
          store.listeners.forEach((l) => l());
          throw err;
        }
      },
    }),
  };
});

vi.mock("../../../lib/hooks/useResidentToken", () => ({ useResidentToken: () => "me" }));

const ID = "r1" as Id<"reports">;
function report(overrides: Partial<PublicReport> = {}): PublicReport {
  return {
    _id: ID,
    _creationTime: 0,
    mediaType: "video",
    lat: 33.8187,
    lng: -84.5824,
    owner: "cobb" as Owner,
    title: "A problem",
    status: "open",
    audioMuted: false,
    isSample: false,
    meTooCount: 2,
    lastActivityAt: 0,
    revealViews: 0,
    createdAt: 0,
    clipUrl: null,
    frameUrls: [],
    fixUrl: null,
    ...overrides,
  };
}

const relationArgs = { token: "me", reportIds: [ID] };
function seed(r: PublicReport, relation: { mine: string[]; meTooed: string[] }) {
  set("feed:feed", {}, [r]);
  set("relation:myRelation", relationArgs, relation);
}

// Like the feed: the card's report comes from the live feed query.
function LiveCard() {
  useSyncExternalStore(
    (l) => {
      store.listeners.add(l);
      return () => store.listeners.delete(l);
    },
    () => store.version,
  );
  const r = (find("feed:feed", {})?.value as PublicReport[])[0];
  return <CardRail report={r} active near video={null} />;
}

const button = () => screen.queryByRole("button", { name: /^Me too/ });

beforeEach(() => {
  store.entries = [];
  store.version = 0;
  store.server = async () => ({ added: true });
});
afterEach(cleanup);

describe("CardRail", () => {
  test("tapping increments the count right away and shows pressed", async () => {
    let resolve!: (v: unknown) => void;
    store.server = () => new Promise((r) => (resolve = r));
    seed(report(), { mine: [], meTooed: [] });
    render(<LiveCard />);
    expect(button()?.textContent).toBe("Me too · 2");
    expect(button()?.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(button()!);
    // Before the server answers.
    expect(button()?.textContent).toBe("Me too · 3");
    expect(button()?.getAttribute("aria-pressed")).toBe("true");
    expect((button() as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve({ added: true }));
  });

  test("rolls back if the server rejects the tap", async () => {
    store.server = async () => {
      throw new Error("You can only me-too an open report");
    };
    seed(report(), { mine: [], meTooed: [] });
    render(<LiveCard />);
    await act(async () => fireEvent.click(button()!));
    expect(button()?.textContent).toBe("Me too · 2");
    expect(button()?.getAttribute("aria-pressed")).toBe("false");
  });

  test("after a reload, pressed comes from myRelation", () => {
    seed(report({ meTooCount: 3 }), { mine: [], meTooed: [ID] });
    render(<LiveCard />);
    expect(button()?.getAttribute("aria-pressed")).toBe("true");
    expect(button()?.textContent).toBe("Me too · 3");
  });

  test("hidden on your own posts", () => {
    seed(report(), { mine: [ID], meTooed: [] });
    render(<LiveCard />);
    expect(button()).toBeNull();
  });

  test("hidden on fixed cards", () => {
    seed(report({ status: "fixed" }), { mine: [], meTooed: [] });
    render(<LiveCard />);
    expect(button()).toBeNull();
  });

  test("hidden until myRelation loads, and not queried for far cards", () => {
    set("feed:feed", {}, [report()]);
    render(<LiveCard />);
    expect(button()).toBeNull();
    cleanup();
    seed(report(), { mine: [], meTooed: [] });
    render(<CardRail report={report()} active={false} near={false} video={null} />);
    expect(button()).toBeNull();
  });

  test("sits above Is it fixed? when the card has one, and in its place on city cards", () => {
    seed(report(), { mine: [], meTooed: [] });
    render(<LiveCard />);
    expect(button()?.className).toContain("bottom-[302px]");
    cleanup();
    seed(report({ owner: "city" }), { mine: [], meTooed: [] });
    render(<LiveCard />);
    expect(button()?.className).toContain("bottom-[216px]");
  });
});
