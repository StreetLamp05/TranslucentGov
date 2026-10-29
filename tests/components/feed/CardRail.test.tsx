// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CardRail from "../../../components/feed/CardRail";
import type { PublicReport } from "../../../server/lib/publicReport";
import type { Owner } from "../../../server/lib/routing";

// The rail polls the caller's relation to its card (US37) and posts a me-too. Both go through
// lib/data, so the tests stand in for the two calls.
type Relation = { mine: string[]; meTooed: string[] };
const state = vi.hoisted(() => ({
  relation: undefined as Relation | undefined,
  keys: [] as (string | null)[],
  fetchers: [] as (() => unknown)[],
  mutate: (async () => ({ added: true })) as (path: string, body: unknown) => Promise<unknown>,
  queries: [] as { path: string; args: unknown }[],
}));

vi.mock("../../../lib/data/useLive", () => ({
  useLive: (key: string | null, fetcher: (signal: AbortSignal) => unknown) => {
    state.keys.push(key);
    if (key === null) return undefined;
    state.fetchers.push(() => fetcher(new AbortController().signal));
    return state.relation;
  },
}));
vi.mock("../../../lib/data/api", () => ({
  mutate: (path: string, body: unknown) => state.mutate(path, body),
  query: async (path: string, args: unknown) => {
    state.queries.push({ path, args });
    return state.relation;
  },
}));
vi.mock("../../../lib/hooks/useResidentToken", () => ({ useResidentToken: () => "me" }));

const ID = "r1";
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

const rail = (r: PublicReport, near = true) => <CardRail report={r} active near={near} video={null} />;
const button = () => screen.queryByRole("button", { name: /^Me too/ });

beforeEach(() => {
  state.relation = { mine: [], meTooed: [] };
  state.keys = [];
  state.fetchers = [];
  state.queries = [];
  state.mutate = async () => ({ added: true });
});
afterEach(cleanup);

describe("CardRail", () => {
  test("tapping increments the count right away and shows pressed", async () => {
    let resolve!: (v: unknown) => void;
    const calls: unknown[][] = [];
    state.mutate = (...args) => {
      calls.push(args);
      return new Promise((r) => (resolve = r));
    };
    render(rail(report()));
    expect(button()?.textContent).toBe("Me too · 2");
    expect(button()?.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(button()!);
    // Before the server answers.
    expect(button()?.textContent).toBe("Me too · 3");
    expect(button()?.getAttribute("aria-pressed")).toBe("true");
    expect((button() as HTMLButtonElement).disabled).toBe(true);
    expect(calls).toEqual([["/api/me-too", { reportId: ID }]]);
    await act(async () => resolve({ added: true }));
  });

  test("the refetched count replaces the optimistic one, without counting the tap twice", async () => {
    const view = render(rail(report()));
    await act(async () => fireEvent.click(button()!));
    // The feed refetch lands first, then the relation's.
    view.rerender(rail(report({ meTooCount: 3 })));
    expect(button()?.textContent).toBe("Me too · 3");
    state.relation = { mine: [], meTooed: [ID] };
    view.rerender(rail(report({ meTooCount: 3 })));
    expect(button()?.textContent).toBe("Me too · 3");
    expect(button()?.getAttribute("aria-pressed")).toBe("true");
  });

  test("rolls back if the server rejects the tap", async () => {
    state.mutate = async () => {
      throw new Error("You can only me-too an open report");
    };
    render(rail(report()));
    await act(async () => fireEvent.click(button()!));
    expect(button()?.textContent).toBe("Me too · 2");
    expect(button()?.getAttribute("aria-pressed")).toBe("false");
  });

  test("after a reload, pressed comes from the relation", () => {
    state.relation = { mine: [], meTooed: [ID] };
    render(rail(report({ meTooCount: 3 })));
    expect(button()?.getAttribute("aria-pressed")).toBe("true");
    expect(button()?.textContent).toBe("Me too · 3");
  });

  test("hidden on your own posts", () => {
    state.relation = { mine: [ID], meTooed: [] };
    render(rail(report()));
    expect(button()).toBeNull();
  });

  test("hidden on fixed cards", () => {
    render(rail(report({ status: "fixed" })));
    expect(button()).toBeNull();
  });

  test("hidden until the relation loads, and not polled for far cards", () => {
    state.relation = undefined;
    render(rail(report()));
    expect(button()).toBeNull();
    cleanup();

    state.relation = { mine: [], meTooed: [] };
    state.keys = [];
    render(rail(report(), false));
    expect(button()).toBeNull();
    expect(new Set(state.keys)).toEqual(new Set([null]));
  });

  test("polls GET /api/relation for its own card, keyed by device and report", async () => {
    render(rail(report()));
    expect(state.keys).toContain(`relation:me:${ID}`);
    await state.fetchers[0]();
    expect(state.queries).toEqual([{ path: "/api/relation", args: { reportIds: [ID] } }]);
  });

  test("sits above Is it fixed? when the card has one, and in its place on city cards", () => {
    render(rail(report()));
    expect(button()?.className).toContain("bottom-[302px]");
    cleanup();
    render(rail(report({ owner: "city" })));
    expect(button()?.className).toContain("bottom-[216px]");
  });
});
