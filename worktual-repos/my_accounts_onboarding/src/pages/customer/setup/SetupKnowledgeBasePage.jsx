import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Search, Trash2, Upload } from "lucide-react";

import { SetupPageHeader } from "../../../components/customer/setup/SetupPageChrome.jsx";
import {
  KNOWLEDGE_CATEGORY_TABS,
  deleteKnowledgeDocument,
  listBranches,
  listKnowledgeDocuments,
  uploadKnowledgeDocument,
} from "../../../lib/setup/setupApi.js";

const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".pdf", ".doc", ".docx", ".txt", ".csv", ".xls", ".xlsx"];

function isAllowedFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function SetupKnowledgeBasePage() {
  const fileInputRef = useRef(null);
  const [activeCategory, setActiveCategory] = useState("business");
  const [documents, setDocuments] = useState([]);
  const [branches, setBranches] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [allBranches, setAllBranches] = useState(true);
  const [selectedBranchIds, setSelectedBranchIds] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const activeTab = useMemo(
    () => KNOWLEDGE_CATEGORY_TABS.find((tab) => tab.id === activeCategory) || KNOWLEDGE_CATEGORY_TABS[0],
    [activeCategory],
  );

  const refresh = useCallback(async () => {
    const [docs, branchRows] = await Promise.all([
      listKnowledgeDocuments(activeCategory),
      listBranches(),
    ]);
    setDocuments(docs);
    setBranches(branchRows);
  }, [activeCategory]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await refresh();
        if (!cancelled) setError("");
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load knowledge documents.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const filteredDocuments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return documents;
    return documents.filter((doc) => {
      const haystack = [
        doc.fileName,
        doc.fileType,
        doc.fileSize,
        doc.uploadedOn,
        ...(doc.assignedBranches || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [documents, searchQuery]);

  function toggleBranch(branchId) {
    setAllBranches(false);
    setSelectedBranchIds((current) =>
      current.includes(branchId)
        ? current.filter((id) => id !== branchId)
        : [...current, branchId],
    );
  }

  async function handleFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;

    if (!allBranches && !selectedBranchIds.length) {
      setError("Select at least one branch, or choose All Branches.");
      return;
    }

    setError("");
    setSuccess("");
    setUploading(true);

    try {
      let uploadedCount = 0;
      for (const file of files) {
        if (!isAllowedFile(file)) {
          throw new Error(`Unsupported file: ${file.name}. Use PDF, DOCX, TXT, CSV, or Excel.`);
        }
        if (file.size > MAX_BYTES) {
          throw new Error(`${file.name} exceeds the 15MB limit.`);
        }
        await uploadKnowledgeDocument({
          file,
          category: activeCategory,
          allBranches,
          assignedBranchIds: allBranches ? [] : selectedBranchIds,
        });
        uploadedCount += 1;
      }
      await refresh();
      setSuccess(
        uploadedCount === 1
          ? "File uploaded successfully."
          : `${uploadedCount} files uploaded successfully.`,
      );
    } catch (err) {
      setError(err.message || "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(doc) {
    if (!window.confirm(`Delete “${doc.fileName}”?`)) return;
    try {
      setError("");
      await deleteKnowledgeDocument(doc.id);
      await refresh();
      setSuccess("Document removed.");
    } catch (err) {
      setError(err.message || "Failed to delete document.");
    }
  }

  function onDrop(event) {
    event.preventDefault();
    setDragActive(false);
    handleFiles(event.dataTransfer?.files);
  }

  return (
    <section className="setup-workspace-page">
      <SetupPageHeader
        copy="Upload policies, corporate directories, sheets, and manuals to enrich corporate AI Assist intelligence models."
        title="Knowledge Base"
      />

      {success ? <div className="form-success-banner">{success}</div> : null}
      {error ? <div className="form-error-banner">{error}</div> : null}

      <div className="setup-workspace-layout">
        <div className="setup-workspace-main">
          <div className="setup-kb-tabs" role="tablist" aria-label="Knowledge categories">
            {KNOWLEDGE_CATEGORY_TABS.map((tab) => (
              <button
                aria-selected={activeCategory === tab.id}
                className={`setup-kb-tab ${activeCategory === tab.id ? "is-active" : ""}`}
                key={tab.id}
                onClick={() => {
                  setActiveCategory(tab.id);
                  setSearchQuery("");
                  setSuccess("");
                  setError("");
                }}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="setup-kb-branch-picker">
            <span>Assign upload to</span>
            <div className="setup-chip-row">
              <button
                className={`setup-chip ${allBranches ? "is-active" : ""}`}
                onClick={() => {
                  setAllBranches(true);
                  setSelectedBranchIds([]);
                }}
                style={
                  allBranches
                    ? { background: "var(--color-neutral-900, #111)", color: "#fff" }
                    : undefined
                }
                type="button"
              >
                All Branches
              </button>
              {branches.map((branch) => {
                const active = !allBranches && selectedBranchIds.includes(branch.id);
                return (
                  <button
                    className={`setup-chip ${active ? "is-active" : ""}`}
                    key={branch.id}
                    onClick={() => toggleBranch(branch.id)}
                    style={
                      active
                        ? { background: "var(--color-neutral-900, #111)", color: "#fff" }
                        : undefined
                    }
                    type="button"
                  >
                    {branch.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            className={`setup-kb-dropzone ${dragActive ? "is-active" : ""} ${uploading ? "is-busy" : ""}`}
            onClick={() => !uploading && fileInputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            <input
              accept=".pdf,.doc,.docx,.txt,.csv,.xls,.xlsx"
              hidden
              multiple
              onChange={(event) => handleFiles(event.target.files)}
              ref={fileInputRef}
              type="file"
            />
            <Upload size={28} strokeWidth={1.75} />
            <p>
              {uploading
                ? "Uploading…"
                : `Drag & drop your files here, or click to browse. Upload to ${activeTab.label}.`}
            </p>
            <small>Supports PDF, DOCX, TXT, CSV, Excel up to 15MB.</small>
          </div>

          <label className="setup-search-field">
            <Search size={16} />
            <input
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={`Search in ${activeTab.label}...`}
              type="search"
              value={searchQuery}
            />
          </label>

          {loading ? (
            <p style={{ fontSize: "13px" }}>Loading documents…</p>
          ) : (
            <div className="setup-table-wrap">
              <table className="setup-table setup-kb-table">
                <thead>
                  <tr>
                    <th>File name</th>
                    <th>File type</th>
                    <th>File size</th>
                    <th>Uploaded on</th>
                    <th>Assigned branches</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocuments.map((doc) => (
                    <tr key={doc.id}>
                      <td>
                        <div className="setup-bh-name">
                          <span className="setup-bh-name__icon">
                            <FileText size={16} />
                          </span>
                          <strong>{doc.fileName}</strong>
                        </div>
                      </td>
                      <td>{doc.fileType}</td>
                      <td>{doc.fileSize}</td>
                      <td>{doc.uploadedOn}</td>
                      <td>
                        <div className="setup-chip-row">
                          {(doc.assignedBranches || []).length ? (
                            doc.assignedBranches.map((branch) => (
                              <span className="setup-chip" key={`${doc.id}-${branch}`}>
                                {branch}
                              </span>
                            ))
                          ) : (
                            <span className="setup-chip">—</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <button
                          className="secondary-button setup-icon-button setup-kb-delete"
                          onClick={() => handleDelete(doc)}
                          title="Delete"
                          type="button"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!filteredDocuments.length ? (
                    <tr>
                      <td colSpan={6}>
                        {documents.length
                          ? "No documents match your search."
                          : `No files in ${activeTab.label} yet.`}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="setup-workspace-aside">
          <section className="setup-usage-panel">
            <h2>Knowledge overview</h2>
            <p>Total uploaded files in {activeTab.label}.</p>
            <div className="setup-usage-panel__stats">
              <div>
                <span>Total uploaded files</span>
                <strong>{documents.length}</strong>
              </div>
            </div>
          </section>

          <section className="setup-usage-panel">
            <h2>AI Assist training</h2>
            <p>
              All files uploaded here are automatically processed and split into vector chunks,
              instantly powering semantic answer systems on CRM web chats or call routing scripts.
            </p>
          </section>
        </aside>
      </div>
    </section>
  );
}
