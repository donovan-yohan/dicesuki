"""
Contract validation methods for store, API, and race condition detection.
These were missing from the original validate.py implementation.
"""

import re
from pathlib import Path
from typing import Dict, List, Optional
from collections import defaultdict


def extract_store_contracts(project_root: Path, agent_outputs: Dict[str, Dict]) -> Optional[Dict]:
    """
    Extract store definitions and usages from agent outputs.
    
    Returns:
        {
            'definitions': {store_name: interface_definition},
            'usages': {file_path: [accessed_properties]}
        }
    """
    definitions = {}
    usages = {}
    
    # Extract store definitions from interfaces
    for agent, output in agent_outputs.items():
        for interface_name, interface_def in output.get('interfaces', {}).items():
            # Detect store interfaces (end with 'Store' or 'State')
            if interface_name.endswith('Store') or interface_name.endswith('State'):
                definitions[interface_name] = interface_def
    
    # Extract store usages from modified files
    for output in agent_outputs.values():
        for file_path_str in output.get('filesModified', []) + output.get('filesCreated', []):
            file_path = project_root / file_path_str
            
            if file_path.exists() and file_path.suffix in ['.ts', '.tsx']:
                content = file_path.read_text()
                
                # Find store hook calls: const { prop1, prop2 } = useXXXStore()
                # Using raw string to avoid escape issues
                store_pattern = r'const\s*\{([^}]+)\}\s*=\s*use(\w+Store)\(\)'
                matches = re.findall(store_pattern, content)
                
                for props_str, store_name in matches:
                    # Parse property names
                    props = [p.strip().split(':')[0].strip() for p in props_str.split(',')]
                    
                    if file_path not in usages:
                        usages[file_path] = []
                    usages[file_path].extend(props)
    
    if not definitions:
        return None
    
    return {'definitions': definitions, 'usages': usages}


def validate_component_props(project_root: Path, agent_outputs: Dict[str, Dict]) -> List[str]:
    """
    Validate that component prop usages match interface definitions.
    
    Returns:
        List of conflicts for mismatched props
    """
    conflicts = []
    
    # Extract component prop interfaces
    component_interfaces = {}
    for agent, output in agent_outputs.items():
        for interface_name, interface_def in output.get('interfaces', {}).items():
            # Detect component prop interfaces (end with 'Props')
            if interface_name.endswith('Props'):
                # Extract property names from interface definition
                # Matches: propertyName: type or propertyName?: type
                props = set(re.findall(r'(\w+)\s*[?:]', interface_def))
                component_interfaces[interface_name] = {
                    'props': props,
                    'definition': interface_def
                }
    
    # Find JSX usages and validate props
    for output in agent_outputs.values():
        for file_path_str in output.get('filesModified', []) + output.get('filesCreated', []):
            file_path = project_root / file_path_str
            
            if file_path.exists() and file_path.suffix in ['.tsx']:
                content = file_path.read_text()
                
                # Check each component interface
                for interface_name, interface_data in component_interfaces.items():
                    component_name = interface_name.replace('Props', '')
                    
                    # Find usages of this component
                    # Simplified pattern - full JSX parsing would be more robust
                    component_pattern = f'<{component_name}[\\s\\n]+([^/>]*)/>'
                    matches = re.findall(component_pattern, content, re.MULTILINE)
                    
                    for props_str in matches:
                        # Extract prop names used
                        used_props = set(re.findall(r'(\w+)=', props_str))
                        
                        # Check for undefined props
                        undefined_props = used_props - interface_data['props']
                        
                        if undefined_props:
                            conflicts.append(
                                f"❌ CRITICAL: Component '{component_name}' used with undefined props: {', '.join(undefined_props)}\n"
                                f"  File: {file_path.name}\n"
                                f"  Expected props: {', '.join(interface_data['props'])}"
                            )
    
    return conflicts


def detect_race_conditions(project_root: Path, agent_outputs: Dict[str, Dict]) -> List[str]:
    """
    Detect potential race conditions from concurrent state updates.
    
    Checks for:
    - Multiple agents modifying same store
    - Async state updates without proper synchronization
    - Event handlers that don't use functional updates
    
    Returns:
        List of warnings for potential race conditions
    """
    warnings = []
    
    # Track which stores are modified by which agents
    store_modifiers = defaultdict(list)
    
    for agent, output in agent_outputs.items():
        for file_path_str in output.get('filesModified', []) + output.get('filesCreated', []):
            file_path = project_root / file_path_str
            
            if file_path.exists() and file_path.suffix in ['.ts', '.tsx']:
                content = file_path.read_text()
                
                # Find store modifications: store.setState(...)
                store_set_pattern = r'(\w+)\.setState\('
                matches = re.findall(store_set_pattern, content)
                
                for store_var in matches:
                    store_modifiers[store_var].append({
                        'agent': agent,
                        'file': file_path.name
                    })
                
                # Check for non-functional setState calls (potential race condition)
                # setState({ ... }) instead of setState(state => ({ ... }))
                non_functional_pattern = r'setState\(\s*\{[^}]+\}\s*\)'
                if re.search(non_functional_pattern, content):
                    warnings.append(
                        f"⚠️  MEDIUM: Potential race condition in {file_path.name}\n"
                        f"  Non-functional setState found (direct object instead of updater function)\n"
                        f"  Consider: setState(state => {{ ...state, newValue }})"
                    )
    
    # Check for stores modified by multiple agents
    for store, modifiers in store_modifiers.items():
        if len(modifiers) > 1:
            agent_list = ', '.join(f"{m['agent']} ({m['file']})" for m in modifiers)
            warnings.append(
                f"⚠️  HIGH: Store '{store}' modified by multiple agents: {agent_list}\n"
                f"  Ensure proper synchronization to avoid race conditions"
            )
    
    return warnings
