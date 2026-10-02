"""programming inventory

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-02 11:46:38.486064
"""
from alembic import op
import sqlalchemy as sa


revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Balance key changes from product_id to (programming_id, product_id): surrogate id, existing rows kept
    # as the legacy global bucket (programming_id NULL).
    op.add_column('inventory_balances', sa.Column('id', sa.Uuid(), nullable=False,
                                                  server_default=sa.text('gen_random_uuid()')))
    op.alter_column('inventory_balances', 'id', server_default=None)
    op.drop_constraint('pk_inventory_balances', 'inventory_balances', type_='primary')
    op.create_primary_key('pk_inventory_balances', 'inventory_balances', ['id'])
    op.add_column('inventory_balances', sa.Column('programming_id', sa.Uuid(), nullable=True))
    op.create_index('uq_inventory_balances_legacy_product', 'inventory_balances', ['product_id'], unique=True, postgresql_where=sa.text('programming_id IS NULL'))
    op.create_index('uq_inventory_balances_programming_product', 'inventory_balances', ['programming_id', 'product_id'], unique=True, postgresql_where=sa.text('programming_id IS NOT NULL'))
    op.create_foreign_key(op.f('fk_inventory_balances_programming_id_load_programmings'), 'inventory_balances', 'load_programmings', ['programming_id'], ['id'])
    op.add_column('inventory_movements', sa.Column('programming_id', sa.Uuid(), nullable=True))
    op.create_index(op.f('ix_inventory_movements_programming_id'), 'inventory_movements', ['programming_id'], unique=False)
    op.create_foreign_key(op.f('fk_inventory_movements_programming_id_load_programmings'), 'inventory_movements', 'load_programmings', ['programming_id'], ['id'])
    op.add_column('scans', sa.Column('programming_id', sa.Uuid(), nullable=True))
    op.create_index(op.f('ix_scans_programming_id'), 'scans', ['programming_id'], unique=False)
    op.create_foreign_key(op.f('fk_scans_programming_id_load_programmings'), 'scans', 'load_programmings', ['programming_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint(op.f('fk_scans_programming_id_load_programmings'), 'scans', type_='foreignkey')
    op.drop_index(op.f('ix_scans_programming_id'), table_name='scans')
    op.drop_column('scans', 'programming_id')
    op.drop_constraint(op.f('fk_inventory_movements_programming_id_load_programmings'), 'inventory_movements', type_='foreignkey')
    op.drop_index(op.f('ix_inventory_movements_programming_id'), table_name='inventory_movements')
    op.drop_column('inventory_movements', 'programming_id')
    op.drop_constraint(op.f('fk_inventory_balances_programming_id_load_programmings'), 'inventory_balances', type_='foreignkey')
    op.drop_index('uq_inventory_balances_programming_product', table_name='inventory_balances', postgresql_where=sa.text('programming_id IS NOT NULL'))
    op.drop_index('uq_inventory_balances_legacy_product', table_name='inventory_balances', postgresql_where=sa.text('programming_id IS NULL'))
    op.execute("DELETE FROM inventory_balances WHERE programming_id IS NOT NULL")
    op.drop_column('inventory_balances', 'programming_id')
    op.drop_constraint('pk_inventory_balances', 'inventory_balances', type_='primary')
    op.drop_column('inventory_balances', 'id')
    op.create_primary_key('pk_inventory_balances', 'inventory_balances', ['product_id'])
