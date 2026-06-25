-- Remove ZizkaDB partner connector (partnership ended). Custom API push covers arbitrary push sources.

DELETE FROM connector_signal_map WHERE source_id = 'zizkadb';
