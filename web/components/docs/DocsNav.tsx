import s from "./docs.module.css";

interface Props {
  prev?: { href: string; title: string };
  next?: { href: string; title: string };
  prevLabel?: string;
  nextLabel?: string;
}

export default function DocsNav({ prev, next, prevLabel = "Previous", nextLabel = "Next" }: Props) {
  return (
    <div className={s.pageNav}>
      {prev ? (
        <a href={prev.href} className={s.pageNavLink}>
          <span className={s.pageNavDir}>&larr; {prevLabel}</span>
          <span className={s.pageNavTitle}>{prev.title}</span>
        </a>
      ) : (
        <div />
      )}
      {next ? (
        <a href={next.href} className={`${s.pageNavLink} ${s.pageNavNext}`}>
          <span className={s.pageNavDir}>{nextLabel} &rarr;</span>
          <span className={s.pageNavTitle}>{next.title}</span>
        </a>
      ) : null}
    </div>
  );
}
