// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import CardActions from "../../../components/feed/CardActions";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PublicReport } from "../../../convex/lib/publicReport";
import type { Owner } from "../../../server/lib/routing";

function report(owner: Owner, status: PublicReport["status"] = "open"): PublicReport {
  return {
    _id: "r1" as Id<"reports">,
    _creationTime: 0,
    mediaType: "video",
    lat: 33.8187,
    lng: -84.5824,
    owner,
    title: "A problem",
    status,
    audioMuted: false,
    isSample: false,
    meTooCount: 0,
    lastActivityAt: 0,
    revealViews: 0,
    createdAt: 0,
    clipUrl: null,
    frameUrls: [],
    fixUrl: null,
  };
}

const renderCard = (r: PublicReport) => render(<CardActions report={r} active near video={null} />);
const button = () => screen.queryByRole("link", { name: "Is it fixed?" });

afterEach(cleanup);

describe("CardActions", () => {
  test.each(["cobb", "utility", "unknown"] as const)("shows Is it fixed? on an open %s card, linking to the capture screen", (owner) => {
    renderCard(report(owner));
    expect(button()?.getAttribute("href")).toBe("/confirm/r1");
  });

  test("hides it on an open city card (only fixers close those)", () => {
    renderCard(report("city"));
    expect(button()).toBeNull();
  });

  test.each(["cobb", "utility", "unknown", "city"] as const)("hides it on a fixed %s card", (owner) => {
    renderCard(report(owner, "fixed"));
    expect(button()).toBeNull();
  });
});
