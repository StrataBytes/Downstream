// a queue tag that opens a menu of its options, or stays a plain tag while it can't change.
// a value none of the options match, like a mix across several items, shows as the placeholder.
export default function TagSelect({ value, options, onChange, disabled, title, placeholder }) {
  const known = options.some((o) => o.id === value);
  const label = known ? options.find((o) => o.id === value).label : placeholder;
  if (disabled) return <span className="tag" title={title}>{label}</span>;

  return (
    <span className="tag tag-select">
      <select value={known ? value : ''} onChange={(e) => onChange(e.target.value)} title={title}>
        {!known && <option value="" disabled>{placeholder}</option>}
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {label}
      <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="2,3.5 5,6.5 8,3.5" />
      </svg>
    </span>
  );
}
