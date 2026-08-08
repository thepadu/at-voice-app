type PaginationProps = {
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
};

export default function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
    if (totalPages <= 1) return null;

    return (
        <div className="pagination">
            <button className="btn btn-secondary" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
                Previous
            </button>
            <span className="pagination-status">
                Page {page} of {totalPages}
            </span>
            <button className="btn btn-secondary" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
                Next
            </button>
        </div>
    );
}
