import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// next/og cannot render <text>, so this draws the SealMark rings inline.
export default function Icon(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F7F7F4",
        }}
      >
        <svg width={28} height={28} viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="47" fill="none" stroke="#5B3FA3" strokeWidth="6" />
          <circle cx="50" cy="50" r="36" fill="none" stroke="#5B3FA3" strokeWidth="3" />
          <circle cx="50" cy="50" r="18" fill="#5B3FA3" />
        </svg>
      </div>
    ),
    size,
  );
}
