import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page-pad">
      <div className="panel" style={{ padding: "2rem", textAlign: "center", maxWidth: 480, margin: "10vh auto 0" }}>
        <h1 style={{ margin: "0 0 6px", fontSize: "1.2rem" }}>Page not found</h1>
        <p className="muted" style={{ margin: "0 0 16px", fontSize: "0.9rem" }}>
          The page you are looking for does not exist or has moved.
        </p>
        <Link className="btn btn-primary" href="/">
          Back to home
        </Link>
      </div>
    </div>
  );
}
