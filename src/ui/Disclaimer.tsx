export function Disclaimer({ councilUrl, fixture }: { councilUrl: string; fixture: boolean }) {
  return <aside className="disclaimer">
    <p>Local rules vary. Check your council’s current guidance before disposing of an item.</p>
    {fixture && <p><strong>Synthetic council link:</strong> Fixture City is not a real council. This link is an illustrative citation.</p>}
    <a href={councilUrl} target="_blank" rel="noopener noreferrer">Check council guidance ↗</a>
  </aside>;
}
