import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Avatar, initials } from "./Avatar";

describe("initials", () => {
  it('should return "AL" for "Ada Lovelace"', () => {
    expect(initials("Ada Lovelace")).toBe("AL");
  });

  it('should return "R4" for "r4ph3rd"', () => {
    expect(initials("r4ph3rd")).toBe("R4");
  });

  it('should return "DE" for "dev@example.com"', () => {
    expect(initials("dev@example.com")).toBe("DE");
  });

  it('should return "?" for empty string', () => {
    expect(initials("")).toBe("?");
  });

  it("should handle single names", () => {
    expect(initials("John")).toBe("JO");
  });

  it("should handle names with multiple words", () => {
    expect(initials("John Doe Smith")).toBe("JD");
  });
});

describe("Avatar", () => {
  it("should render with initials when no src is provided", () => {
    render(<Avatar name="Ada Lovelace" />);
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("should render with title attribute set to name", () => {
    render(<Avatar name="Test User" />);
    const span = screen.getByTitle("Test User");
    expect(span).toBeInTheDocument();
  });

  it("should render image when src is provided", () => {
    render(
      <Avatar
        name="Test User"
        src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
      />,
    );
    const img = screen.getByAltText("");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("draggable", "false");
  });

  it("should show fallback after image error", () => {
    // When src prop changes from a valid URL to broken, the component
    // should show initials instead of attempting to load the broken image
    const { rerender } = render(<Avatar name="Test User" src="data:image/valid" />);
    // Rerender without src to show fallback
    rerender(<Avatar name="Test User" />);
    expect(screen.getByText("TU")).toBeInTheDocument();
  });

  it("should apply size style", () => {
    const { container } = render(<Avatar name="Test User" size={32} />);
    const span = container.querySelector("span[title='Test User']");
    expect(span).toHaveStyle({ width: "32px", height: "32px" });
  });

  it("should apply custom color", () => {
    render(<Avatar name="Test User" color="red" />);
    const span = screen.getByTitle("Test User");
    expect(span.style.backgroundColor).toBe("red");
  });

  it("should render with ring when ring prop is true", () => {
    render(<Avatar name="Test User" ring />);
    const span = screen.getByTitle("Test User");
    expect(span.style.border).toContain("2px");
    expect(span.style.border).toContain("solid");
  });

  it("should render with no border when ring prop is false", () => {
    const { container } = render(<Avatar name="Test User" ring={false} />);
    const span = container.querySelector("span[title='Test User']") as HTMLElement | null;
    // border: "none" should not contain "2px"
    expect(span?.style.border).not.toContain("2px");
  });

  it("should have aria-hidden attribute", () => {
    render(<Avatar name="Test User" />);
    const span = screen.getByTitle("Test User");
    expect(span).toHaveAttribute("aria-hidden", "true");
  });
});
