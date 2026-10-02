"""bifurcated base tracking (product kind, side rule, scan/movement side)

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-02 16:20:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing products are all NORMAL (server default fills existing rows).
    op.add_column('items', sa.Column('product_kind', sa.String(length=30), server_default='NORMAL', nullable=False))
    op.add_column('items', sa.Column('side_rule', sa.String(length=80), nullable=True))
    op.add_column('scans', sa.Column('side', sa.String(length=10), nullable=True))
    op.add_column('inventory_movements', sa.Column('side', sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column('inventory_movements', 'side')
    op.drop_column('scans', 'side')
    op.drop_column('items', 'side_rule')
    op.drop_column('items', 'product_kind')
