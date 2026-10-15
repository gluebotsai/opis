import sys
sys.path.append('.')
from src.config_loader import ConfigLoader

cl = ConfigLoader('config')
t = cl.core_tables['cdp.ai_insights']
print(t.relationships[0].create_target)
