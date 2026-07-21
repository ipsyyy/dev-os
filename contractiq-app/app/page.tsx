export default function Home() {
  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
      color: '#ffffff',
      textAlign: 'center',
      padding: '2rem',
    }}>
      <h1 style={{
        fontSize: '3.5rem',
        fontWeight: 800,
        marginBottom: '1rem',
        background: 'linear-gradient(90deg, #00c6ff, #a78bfa)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
      }}>
        ContractIQ
      </h1>
      <p style={{
        fontSize: '1.25rem',
        color: '#a8b2d8',
        maxWidth: '520px',
        lineHeight: 1.8,
        marginBottom: '2rem',
      }}>
        Upload an NDA or MSA and get key terms extracted, page-attributed, and confidence-scored in minutes — not hours. Not legal advice.
      </p>
      <a
        href="/sign-up"
        className="btn-primary"
      >
        Get Started Free
      </a>
    </main>
  )
}
