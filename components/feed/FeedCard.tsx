import type { PublicReport } from "@/server/lib/publicReport";
import { useT } from "@/lib/i18n/I18nProvider";
import CardActions from "./CardActions";
import CardOverlay from "./CardOverlay";
import CardRail from "./CardRail";
import CardReveal from "./CardReveal";

// What every card slot gets.
// - `active`: this card is the one on screen (the one that plays).
// - `near`: within one card of the screen. Load media (slideshow photos, a fix clip) only when
//   near, so nothing past the next card preloads (file bandwidth is limited).
// - `video`: the pooled <video> playing this card's clip, or null when the card has none or
//   isn't near.
export type FeedSlotProps = {
  report: PublicReport;
  active: boolean;
  near: boolean;
  video: HTMLVideoElement | null;
};

// Layers, bottom to top (the scroller is the stacking context; cards set no z-index, so these
// interleave with the pooled videos, which are siblings of the cards):
//   z-0    frame-0 poster
//   z-[1]  pooled video
//   z-[2]  slot media: slideshow (US17), fix clip (US19). Covers the pooled video.
//   z-[3]  gradients
//   z-[4]  slot text and buttons: overlay, rail, actions
//   z-[5]  the FIXED stamp (US19)
// Within a layer, later slots draw on top: CardReveal comes after CardOverlay, so a fix clip
// covers a slideshow. A slot's root must not create a stacking context (no z-index, transform
// or opacity < 1 on it), or its layers can't interleave with the others.
type Props = FeedSlotProps & { index: number };

// One full-screen, snap-aligned card (§5.1.1). Layout after spec/UI_mockups; the slots own
// everything on top of the media.
export default function FeedCard({ index, ...slot }: Props) {
  const t = useT();
  const { report, near } = slot;
  const poster = report.frameUrls[0];
  return (
    <article
      data-index={index}
      data-report-id={report._id}
      aria-label={report.title ?? t("feed.reportFallback")}
      className="relative h-full w-full snap-start snap-always overflow-hidden bg-black"
    >
      {near && poster && (
        // MinIO URLs, so not next/image.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-[3] h-[150px] bg-gradient-to-b from-black/50 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] h-[430px] max-h-[60%] bg-gradient-to-t from-black/85 to-transparent"
      />
      <CardOverlay {...slot} />
      <CardReveal {...slot} />
      <CardRail {...slot} />
      <CardActions {...slot} />
    </article>
  );
}
