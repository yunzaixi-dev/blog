export default function JsonLd({ data }: { data: unknown }) {
  if (data === undefined || data === null) return null
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  )
}
