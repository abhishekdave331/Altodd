export default function EmptyState({ message = 'Not enough history yet — check back tomorrow.' }) {
    return (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-muted">
            {message}
        </div>
    );
}
