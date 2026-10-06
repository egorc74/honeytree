import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { FeedBadge, HexAvatar, LikeButton, StarRating, StarRatingInput, Tabs } from "@/components/ui";

describe("LikeButton", () => {
  it("exposes pressed state and an accessible name with the count", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<LikeButton liked={false} count={1} onToggle={onToggle} label="game" />);
    const btn = screen.getByRole("button", { name: "Like this game, 1 like" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(<LikeButton liked count={12} onToggle={onToggle} label="game" />);
    expect(screen.getByRole("button", { name: "Unlike this game, 12 likes" })).toHaveAttribute("aria-pressed", "true");
  });

  it("can be disabled for own content", () => {
    render(<LikeButton liked={false} count={0} onToggle={() => {}} label="game" disabled title="no" />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});

describe("StarRatingInput", () => {
  function Harness() {
    const [v, setV] = useState(0);
    return <StarRatingInput value={v} onChange={setV} />;
  }
  it("is a radio group operable with arrow keys", () => {
    render(<Harness />);
    const stars = screen.getAllByRole("radio");
    expect(stars).toHaveLength(5);
    fireEvent.click(stars[2]);
    expect(stars[2]).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(stars[2], { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "4 stars" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(screen.getByRole("radio", { name: "4 stars" }), { key: "Home" });
    expect(screen.getByRole("radio", { name: "1 star" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("StarRating", () => {
  it("describes the rating for screen readers", () => {
    render(<StarRating value={4.5} count={10} />);
    expect(screen.getByRole("img", { name: "Rated 4.5 out of 5 from 10 reviews" })).toBeInTheDocument();
  });
  it("handles no ratings", () => {
    render(<StarRating value={null} />);
    expect(screen.getByRole("img", { name: "No ratings yet" })).toBeInTheDocument();
  });
});

describe("Tabs", () => {
  function Harness() {
    const [v, setV] = useState<"a" | "b" | "c">("a");
    return <Tabs idPrefix="t" label="Demo" value={v} onChange={setV} items={[{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }]} />;
  }
  it("follows the WAI-ARIA tabs keyboard pattern", () => {
    render(<Harness />);
    const [a, b, c] = screen.getAllByRole("tab");
    expect(a).toHaveAttribute("aria-selected", "true");
    expect(b).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(b).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(b, { key: "End" });
    expect(c).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(c, { key: "ArrowRight" });
    expect(a).toHaveAttribute("aria-selected", "true");
  });
});

describe("badges and avatars", () => {
  it("shows the three feed badges", () => {
    render(
      <>
        <FeedBadge kind="fresh" />
        <FeedBadge kind="sweetest" />
        <FeedBadge kind="buzzing" />
      </>,
    );
    expect(screen.getByText("Fresh Nectar")).toBeInTheDocument();
    expect(screen.getByText("Sweetest")).toBeInTheDocument();
    expect(screen.getByText("Buzzing")).toBeInTheDocument();
  });
  it("falls back to initials without a picture", () => {
    render(<HexAvatar name="Queen Bee" />);
    expect(screen.getByRole("img", { name: "Queen Bee's avatar" })).toHaveTextContent("QU");
  });
});
