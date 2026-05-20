import fs from "fs";
import path from "path";
import { getTranslations } from "next-intl/server";
import s from "./lp.module.css";

const R2_PUBLIC = "https://pub-494b37dbfc9645299042fcf51236d1fc.r2.dev/lp-sample/v0.1";

interface Phase {
  start_sec: number;
  end_sec: number;
  text: string;
}

interface Episode {
  index: number;
  video_id: string;
  category: string;
  region: string;
  duration_sec: number;
  length_frames: number;
  task: string;
  phases: Phase[];
}

interface EpisodesDoc {
  fps: number;
  total_episodes: number;
  episodes: Episode[];
}

function loadEpisodes(): EpisodesDoc {
  const p = path.join(process.cwd(), "public", "lp", "sample", "json", "dataset_episodes.json");
  return JSON.parse(fs.readFileSync(p, "utf-8")) as EpisodesDoc;
}

function videoUrl(idx: number): string {
  return `${R2_PUBLIC}/videos/observation.images.ego_cam/chunk-000/episode_${String(idx).padStart(3, "0")}.mp4`;
}

function fmtTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${s.toFixed(1)}s`;
}

export default async function SamplePage() {
  const t = await getTranslations("pages.sample");
  const doc = loadEpisodes();

  return (
    <div className={s.page}>
      {/* Hero */}
      <section className={s.hero}>
        <div className={s.heroInner}>
          <div className={s.heroMain}>
            <div className={s.heroEyebrow}>
              <span>{t("heroEyebrow")}</span>
              <span className={s.heroEyebrowDot}>·</span>
              <span className={s.heroEyebrowDesc}>{t("heroEyebrowDesc")}</span>
            </div>
            <h1 className={s.heroTitleArticle}>{t("heroTitle")}</h1>
            <p className={s.heroDescription}>{t("heroSubtitle")}</p>
          </div>
        </div>
      </section>

      {/* §What it's for */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s1Title")}</h2>
          <p className={s.prose}>{t("s1p1")}</p>
        </div>
      </section>

      {/* §Per-frame contents */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s2Title")}</h2>
          <p className={s.prose}>{t("s2p1")}</p>
          <p className={s.prose}>{t("s2p2")}</p>
        </div>
      </section>

      {/* §Phase labels (explanation, sets up the episode list below) */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s3Title")}</h2>
          <p className={s.prose}>{t("s3p1")}</p>
          <p className={s.prose}>{t("s3p2")}</p>
        </div>
      </section>

      {/* §Episodes — all 48 episodes with full per-phase narration */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("episodesHeading")}</h2>
          <p className={s.prose}>{t("episodesSubheading")}</p>

          <div className={s.episodeList}>
            {doc.episodes.map((ep) => (
              <article key={ep.index} className={s.episodeCard}>
                <div className={s.episodeVideoWrap}>
                  <video
                    controls
                    preload="none"
                    playsInline
                    className={s.episodeVideo}
                    src={videoUrl(ep.index)}
                  />
                </div>
                <div className={s.episodeBody}>
                  <div className={s.episodeMeta}>
                    <span className={s.episodeId}>episode_{String(ep.index).padStart(3, "0")}</span>
                    <span className={s.episodeMetaDot}>·</span>
                    <span>{ep.category}</span>
                    <span className={s.episodeMetaDot}>·</span>
                    <span>{ep.duration_sec.toFixed(1)}s</span>
                    <span className={s.episodeMetaDot}>·</span>
                    <span>{ep.length_frames} {t("episodesFrameLabel")}</span>
                  </div>
                  <p className={s.episodeTask}>{ep.task}</p>
                  <details className={s.episodePhases}>
                    <summary className={s.episodePhasesSummary}>
                      {t("episodesPhasesLabel")} ({ep.phases.length})
                    </summary>
                    <ol className={s.episodePhasesList}>
                      {ep.phases.map((p, i) => (
                        <li key={i} className={s.episodePhasesItem}>
                          <span className={s.episodePhasesTime}>
                            {fmtTimestamp(p.start_sec)}–{fmtTimestamp(p.end_sec)}
                          </span>
                          <span className={s.episodePhasesText}>{p.text}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                  <a
                    href={videoUrl(ep.index)}
                    download={`episode_${String(ep.index).padStart(3, "0")}.mp4`}
                    className={s.episodeDownload}
                  >
                    {t("episodeDownloadLabel")}
                  </a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* §What is NOT in this preview */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s4Title")}</h2>
          <p className={s.prose}>{t("s4p1")}</p>
        </div>
      </section>

      {/* §Files — every file in the dataset, direct links */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s5Title")}</h2>
          <p className={s.prose}>{t("s5p1")}</p>

          {/* Meta + parquet + README をすべて並べる */}
          <h3 className={s.filesGroupHeading}>{t("filesMetaHeading")}</h3>
          <div className={s.faqList}>
            <div className={s.faqRow}>
              <p className={s.faqQuestion}>README.md</p>
              <a href={`${R2_PUBLIC}/README.md`} target="_blank" rel="noopener noreferrer" className={`${s.ctaSecondary} ${s.faqButton}`}>{t("ctaOpen")}</a>
            </div>
            <div className={s.faqRow}>
              <p className={s.faqQuestion}>meta/info.json</p>
              <a href={`${R2_PUBLIC}/meta/info.json`} target="_blank" rel="noopener noreferrer" className={`${s.ctaSecondary} ${s.faqButton}`}>{t("ctaOpen")}</a>
            </div>
            <div className={s.faqRow}>
              <p className={s.faqQuestion}>meta/tasks.jsonl</p>
              <a href={`${R2_PUBLIC}/meta/tasks.jsonl`} target="_blank" rel="noopener noreferrer" className={`${s.ctaSecondary} ${s.faqButton}`}>{t("ctaOpen")}</a>
            </div>
            <div className={s.faqRow}>
              <p className={s.faqQuestion}>meta/stats.json</p>
              <a href={`${R2_PUBLIC}/meta/stats.json`} target="_blank" rel="noopener noreferrer" className={`${s.ctaSecondary} ${s.faqButton}`}>{t("ctaOpen")}</a>
            </div>
            <div className={s.faqRow}>
              <p className={s.faqQuestion}>meta/episodes/chunk-000/file-000.parquet</p>
              <a href={`${R2_PUBLIC}/meta/episodes/chunk-000/file-000.parquet`} className={`${s.ctaSecondary} ${s.faqButton}`}>{t("ctaDownload")}</a>
            </div>
            <div className={s.faqRow}>
              <p className={s.faqQuestion}>data/chunk-000/file-000.parquet</p>
              <a href={`${R2_PUBLIC}/data/chunk-000/file-000.parquet`} className={`${s.ctaSecondary} ${s.faqButton}`}>{t("ctaDownload")}</a>
            </div>
          </div>

          {/* 全 48 動画ファイルの直リンク */}
          <h3 className={s.filesGroupHeading}>{t("filesVideosHeading")}</h3>
          <p className={s.prose} style={{ fontSize: "0.92rem", color: "var(--lp-text-secondary)" }}>
            {t("filesVideosDescription")}
          </p>
          <ul className={s.videoFilesList}>
            {doc.episodes.map((ep) => {
              const name = `episode_${String(ep.index).padStart(3, "0")}.mp4`;
              return (
                <li key={ep.index} className={s.videoFilesItem}>
                  <span className={s.videoFilesName}>videos/observation.images.ego_cam/chunk-000/{name}</span>
                  <a
                    href={videoUrl(ep.index)}
                    download={name}
                    className={`${s.ctaSecondary} ${s.faqButton}`}
                  >
                    {t("ctaDownload")}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* §License */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("licenseHeading")}</h2>
          <p className={s.prose}>
            <span className={s.emphasis}>{t("licenseP1")}</span>
          </p>
        </div>
      </section>
    </div>
  );
}
