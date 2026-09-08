export default function SectionCard({ title, description, children }) {
    return (
        <section className="rounded-xl border border-border bg-surface-raised p-5 flex flex-col gap-3">
            <div>
                <h2 className="text-base font-semibold text-text-primary">{title}</h2>
                {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
            </div>
            {children}
        </section>
    );
}
