function runnerQuery(runner) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function listDocuments(runner, organizationId, category = null) {
  if (category) {
    const { rows } = await runnerQuery(runner).query(
      `SELECT id, organization_id, category, file_name, file_type, file_size_bytes,
              storage_path, all_branches, assigned_branch_ids, uploaded_by, created_at
       FROM setup_knowledge_documents
       WHERE organization_id = $1 AND category = $2
       ORDER BY created_at DESC`,
      [organizationId, category],
    );
    return rows;
  }

  const { rows } = await runnerQuery(runner).query(
    `SELECT id, organization_id, category, file_name, file_type, file_size_bytes,
            storage_path, all_branches, assigned_branch_ids, uploaded_by, created_at
     FROM setup_knowledge_documents
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [organizationId],
  );
  return rows;
}

export async function selectDocument(runner, organizationId, documentId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, organization_id, category, file_name, file_type, file_size_bytes,
            storage_path, all_branches, assigned_branch_ids, uploaded_by, created_at
     FROM setup_knowledge_documents
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, documentId],
  );
  return rows[0] || null;
}

export async function insertDocument(runner, fields) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO setup_knowledge_documents (
       organization_id, category, file_name, file_type, file_size_bytes,
       storage_path, all_branches, assigned_branch_ids, uploaded_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
     RETURNING id, organization_id, category, file_name, file_type, file_size_bytes,
               storage_path, all_branches, assigned_branch_ids, uploaded_by, created_at`,
    [
      fields.organizationId,
      fields.category,
      fields.fileName,
      fields.fileType,
      fields.fileSizeBytes,
      fields.storagePath,
      Boolean(fields.allBranches),
      JSON.stringify(fields.assignedBranchIds || []),
      fields.uploadedBy || null,
    ],
  );
  return rows[0] || null;
}

export async function deleteDocument(runner, organizationId, documentId) {
  const { rowCount } = await runnerQuery(runner).query(
    `DELETE FROM setup_knowledge_documents WHERE organization_id = $1 AND id = $2`,
    [organizationId, documentId],
  );
  return rowCount > 0;
}
