// add hover details 

AFRAME.registerComponent('protein-visualization', {
    schema: {
        displayMode: {type: 'string', default: 'ball-stick'} ,
        higlightChain:{type: 'string'}
    },

    init: async function() {

         
        try {
            this.proteinContainer = document.getElementById('protein-viz-container');
            if (!this.proteinContainer) {
                console.error("Error: #protein-viz-container not found.");
                return;
            }

            // Make the function globally accessible
            window.displayResidue = this.displayResidue.bind(this);
    
            await this.loadStructure();
            this.createVisualisation();
            this.addViewControls();
    
            console.log(" Dispatching protein-visualization-ready event!");
            // Dispatch a custom event to signal that protein-visualization is ready
            this.el.sceneEl.emit("protein-visualization-ready", {});
        } catch (err) {
            console.error("Error initializing protein visualization:", err);
        }

       
    },

    loadStructure: async function(){
        try {
            console.log("Fetching data...");
            
            // Fetch protein json files in parallel
            const [chainsResponse, componentsResponse, structureResponse] = await Promise.all([
                fetch('chains.json'),
                fetch('components.json'),
                fetch('structure.json')
            ]);
    
            // Check for response errors
            if (!chainsResponse.ok) throw new Error("Failed to load chains.json");
            if (!componentsResponse.ok) throw new Error("Failed to load components.json");
            if (!structureResponse.ok) throw new Error("Failed to load structure.json");
    
            // Parse JSON responses and store as java script objects 
            const [chainsData, componentsData, structureData] = await Promise.all([
                chainsResponse.json(),
                componentsResponse.json(),
                structureResponse.json()
            ]);

            // Store them as properties of `this` for easier access across functions 
            this.chainsData = chainsData;
            this.componentsData = componentsData;
            this.structureData = structureData;
        
            // console.log("Successfully loaded protein data");
            // console.log("Chains:", chainsData);      // ➝ Parsed object from chains.json
            // console.log("Components:",componentsData);  // ➝ Parsed object from components.json
            // console.log("Structure:",structureData);   // ➝ Parsed object from structure.json

            // Create a lookup for chains data
            this.chainsLookup = {};
            // Convert chainsData into an iterable list of [chainId, chainAtoms] pairs
            Object.entries(chainsData).forEach(([chainId, chain]) => {
                // keys are the unique chainIds and values are the  list of atom IDs for that chain
                this.chainsLookup[chainId] = chain.atoms;
            });
            
            // console.log("Chains=", this.chainsLookup);

            // Create a lookup for atom positions and element 
            this.atomLookup = {};
            structureData.vertices.forEach(atom => {
                // keys are the unique atom ids and values are the atom is position in the scene
                this.atomLookup[atom.id] = {
                    position: atom.position,
                    element: atom.element
                };
            });
            // console.log("Atoms Lookup:", this.atomLookup);


            this.protein_bound_min = structureData.metadata.bounding_box.min;
            this.protein_bound_max = structureData.metadata.bounding_box.max;
            this.num_atoms = structureData.metadata.total_atoms;

            console.log("Bound Box",this.protein_bound_max);

            this.connections = {};
            // Create a lookup for atom connection
            structureData.connections.forEach(bond => {
                // Checks if bond.from (the first atom in the bond) already has an entry in the connections object
                // If it does NOT exist (!connections[bond.from]), it initializes it as an empty array []
                if (!this.connections[bond.from]) this.connections[bond.from] = [];
                if (!this.connections[bond.to]) this.connections[bond.to] = [];
                
                this.connections[bond.from].push({ to: bond.to, distance: bond.distance });
                this.connections[bond.to].push({ to: bond.from, distance: bond.distance });
            });
            // console.log("Stored Bonds:", this.connections);


        } catch (error) {
            console.error("Error loading data:", error);
            // Allows error handling in the calling function
            throw error; 
        }
    }, 

    getStructureHandler: function() {
        let structureHandlerEl = document.querySelector('[structure-handler]'); // Find element with structure-handler

        if (structureHandlerEl) {
            return structureHandlerEl.components['structure-handler']; // Access its component instance
        } else {
            console.error("Error: structure-handler component not found.");
            return null;
        }
    },

    // Clear previous visualization
    clearVisualization: function() {
        // Loop continues until all child nodes are removed, ensuring the container is empty
        while (this.proteinContainer.firstChild) {
            this.proteinContainer.removeChild(this.proteinContainer.firstChild);
        }
    },

    createLegend: function(displayedAtoms = null) {
        console.log("Creating legend...");

         // Remove any existing legend before creating a new one
        let existingLegend = document.getElementById("atom-legend");
        if (existingLegend) {
            existingLegend.parentNode.removeChild(existingLegend);
        }

        // Error Handeling 
        if (!this.atomLookup || Object.keys(this.atomLookup).length === 0) {
            console.error("Error: atomLookup is not initialized or is empty.");
            return;
        }
    
        // Error Handeling 
        if (!this.protein_bound_max || typeof this.protein_bound_max !== "object") {
            console.error("Error: protein_bound_max is not defined or not an object.");
            return;
        }

        let xLegend =  -10;
        let yLegend = 2;
        let zLegend =  5;

        let legend = document.createElement('a-entity');
        legend.setAttribute('id', 'atom-legend');

        // Positioning the legend slightly to the left
        legend.setAttribute('position', `${xLegend} ${yLegend} ${zLegend}`);

        let atomCounts = this.countAtoms(displayedAtoms);
        let yOffset = 0;

        // Legend Title 
        let titleText = document.createElement('a-text');
        titleText.setAttribute('value', 'Atom Details');
        titleText.setAttribute('position', `0.2 -0.2 0`);
        titleText.setAttribute('color', '#FFFFFF'); // White text
        titleText.setAttribute('align', 'center');
        titleText.setAttribute('scale',  '0.8 0.8 0.8');
        legend.appendChild(titleText);
        yOffset += 0.5; // Space below the title

        Object.entries(atomCounts).forEach(([element, data]) => {
            let text = document.createElement('a-text');
            text.setAttribute('value', `${element}: ${data.count}`);
            text.setAttribute('position', `0 ${-yOffset} 0`);
            text.setAttribute('color', data.color);
            text.setAttribute('align', 'left');
            text.setAttribute('scale', '0.5 0.5 0.5');
            

            legend.appendChild(text);
            yOffset += 0.3;
        });

        this.el.appendChild(legend);
    },

    createVisualisation: function(){
        this.clearVisualization();

        const scale = 0.3; // Scale factor to make the protein fit better in the scene
        const displayMode = this.data.displayMode; // Get updated mode
        let displayedAtoms = null; // Track the atoms currently displayed
        console.log("Rendering visualization mode:", displayMode);

        switch(displayMode){
            case 'ball-stick':
                this.renderBallAndStick(scale);
                displayedAtoms = Object.keys(this.atomLookup); // All atoms
                break;
            case 'space-filling':
                this.renderSpaceFilling(scale);
                displayedAtoms = Object.keys(this.atomLookup); // All atoms
                break;
            case 'chain-A':
                this.renderChainA(scale);
                displayedAtoms = this.chainsLookup["A"]; // Only Chain A atoms
                break;
            case 'chain-B':
                this.renderChainB(scale);
                displayedAtoms = this.chainsLookup["B"]; // Only Chain B atoms
                break;
            case 'chain-C':
                this.renderChainC(scale);
                displayedAtoms = this.chainsLookup["C"]; // Only Chain C atoms
                break;
            case 'chain-D':
                this.renderChainD(scale);
                displayedAtoms = this.chainsLookup["D"]; // Only Chain D atoms
                break;
        
        }

        // Update the title dynamically
        this.displayTitle(displayMode);

        // Update legend with the correct atom count
        this.createLegend(displayedAtoms);
    
    },


    renderBallAndStick: function(scale) {
        //Error Handeling
        if (!this.atomLookup || Object.keys(this.atomLookup).length === 0) {
            console.error("Error: atomLookup is not initialized or is empty.");
            return;
        }
    
        // Batch append atoms
        const fragment = document.createDocumentFragment(); 
    
        Object.entries(this.atomLookup).forEach(([atomId, atom]) => { 
            const [x, y, z] = atom.position;
            const color = this.getAtomColor(atom.element);
        
            if (!color) {
                console.error(`Invalid color for atom type: ${atom.element}`);
                return;
            }
        
            const sphere = document.createElement('a-sphere');
            sphere.setAttribute("id", `atom-${atomId}`);  
            sphere.setAttribute('position', `${x * scale} ${y * scale} ${z * scale}`);
            sphere.setAttribute('radius', this.getAtomRadius(atom.element) * scale);
            sphere.setAttribute('color', color);
            sphere.setAttribute('metalness', '0.2');
            sphere.setAttribute('roughness', '0.3');
            sphere.setAttribute("visible", true);
        
            fragment.appendChild(sphere); 
        });
    
        // Append all at once
        this.proteinContainer.appendChild(fragment); 
    
        // Use requestAnimationFrame to distribute bond rendering over time
        let bondArray = Object.entries(this.connections);
        let bondIndex = 0;
    
        // CHAT GPT Helped with the render repsonse because my visualization was lagging 
        const renderBonds = () => {
            //Show Loading Indicator
            this.displayLoadingIndicator(true);
            const fragmentBonds = document.createDocumentFragment();
            let batchSize = 50; // Render 50 bonds per frame to avoid freezing
    
            for (let i = 0; i < batchSize && bondIndex < bondArray.length; i++, bondIndex++) {
                const [fromAtomId, bonds] = bondArray[bondIndex];
                const fromAtom = this.atomLookup[fromAtomId];
    
                bonds.forEach(bond => {
                    const toAtom = this.atomLookup[bond.to];
    
                    if (!fromAtom || !toAtom) return;
    
                    const [x1, y1, z1] = fromAtom.position;
                    const [x2, y2, z2] = toAtom.position;
    
                    const midX = (x1 + x2) / 2;
                    const midY = (y1 + y2) / 2;
                    const midZ = (z1 + z2) / 2;
    
                    const bondDistance = bond.distance;
                    
                    // Calculate rotation
                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    const dz = z2 - z1;
                    const computedDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    const phi = Math.atan2(dy, dx) * (180 / Math.PI);
                    const theta = Math.acos(dz / bondDistance) * (180 / Math.PI);
    
                    const AtomBond = document.createElement('a-cylinder');
                    AtomBond.setAttribute("id", `bond-${fromAtomId}-${bond.to}`); // assign unique ID 
                    AtomBond.setAttribute('position', `${midX * scale} ${midY * scale} ${midZ * scale}`);
                    AtomBond.setAttribute('height', bondDistance * scale);
                    AtomBond.setAttribute('rotation', `${theta} ${phi} 0`);
                    AtomBond.setAttribute('radius', 0.05 * scale);
                    AtomBond.setAttribute('color', '#CCCCCC');
                    AtomBond.setAttribute("visible", true);
    
                    fragmentBonds.appendChild(AtomBond);
                });
            }
    
            this.proteinContainer.appendChild(fragmentBonds); // Append bond batch
    
            if (bondIndex < bondArray.length) {
                requestAnimationFrame(renderBonds); // Continue rendering next batch
            } else {
                this.displayLoadingIndicator(false); // Hide loading indicator
            }
        };
    
        requestAnimationFrame(renderBonds); // Start bond rendering
    },
    

    // Space filling visualization
    renderSpaceFilling: function(scale) {
        //Error Handeling
        if (!this.atomLookup || Object.keys(this.atomLookup).length === 0) {
            console.error("Error: atomLookup is not initialized or is empty.");
            return;
        }

        Object.entries(this.atomLookup).forEach(([atomId, atom]) => { 

            // get x,y,z coordinated of atom 
            const [x, y, z] = atom.position;
            // get color 
            const color = this.getAtomColor(atom.element);

             // if atom does not exists in list of colors throw error
            if (!color) {
                console.error(`Invalid color for atom type: ${atom.element}`);
                return;
            }

            // Create sphere for the atom
            const sphere = document.createElement('a-sphere');
            sphere.setAttribute("id", `atom-${atomId}`); 
            sphere.setAttribute('position', `${x * scale} ${y * scale} ${z * scale}`);
            sphere.setAttribute('radius', this.getAtomRadius(atom.element, 'space-filling') * scale);
            sphere.setAttribute('color', color);
            sphere.setAttribute('metalness', '0.2');
            sphere.setAttribute('roughness', '0.3');
            sphere.setAttribute('opacity', '0.8'); // Slightly transparent to see structure better
            sphere.setAttribute("visible", true);
            this.proteinContainer.appendChild(sphere);

        });
    },

    renderChainA: function(scale) {
        //Error Handeling
        if (!this.chainsLookup || !this.atomLookup) {
            console.error("Error: atomLookup or chainLookup is not initialized or is empty.");
            return;
        }

        // Ensure Chain A exists in chainsLookup
        if (!this.chainsLookup["A"]) {
            console.error("Error: Chain A is not found in chainsLookup.");
            return;
        }

        // Batch append atoms
        const fragment = document.createDocumentFragment(); 

        // Get all atom IDs in Chain A
        let chainAatoms = this.chainsLookup["A"];  

        console.log("Chain A Atoms:", chainAatoms);
        console.log("Connections Keys:", Object.keys(this.connections).map(Number));  // Convert to numbers

        // Loop over atoms in chain A 
        chainAatoms.forEach(atomId => {
            let atom = this.atomLookup[atomId];  // Retrieve atom details
    
            if (!atom) return;  // Skip missing atoms
    
            const [x, y, z] = atom.position;
            const color = this.getAtomColor(atom.element);
    
            if (!color) {
                console.error(`Invalid color for atom type: ${atom.element}`);
                return;
            }
    
            const sphere = document.createElement('a-sphere');
            sphere.setAttribute("id", `atom-${atomId}`);
            sphere.setAttribute('position', `${x * scale} ${y * scale} ${z * scale}`);
            sphere.setAttribute('radius', this.getAtomRadius(atom.element) * scale);
            sphere.setAttribute('color', color);
            sphere.setAttribute('metalness', '0.2');
            sphere.setAttribute('roughness', '0.3');
            sphere.setAttribute("visible", true);
    
            // Add to fragment (batch for performance)
            fragment.appendChild(sphere);
        });

        // Append all atoms at once
        this.proteinContainer.appendChild(fragment);


        // Render Bonds 
        // Use requestAnimationFrame to distribute bond rendering over time
        let bondArray = Object.entries(this.connections);
        let bondIndex = 0;

        // Filter only the bonds between atoms in Chain A
        let chainABonds = bondArray.filter(([fromAtomId, bonds]) => {
            // Convert ID key from string to number
            const atomId = Number(fromAtomId); 
            return chainAatoms.includes(atomId) && 
                   bonds.some(bond => chainAatoms.includes(bond.to));
        });

        console.log("Filtered Chain A Bonds:", chainABonds);

        const renderBonds = () => {
            //Show Loading Indicator
            this.displayLoadingIndicator(true);
            const fragmentBonds = document.createDocumentFragment();
            let batchSize = 50; // Render 50 bonds per frame to avoid freezing

            for (let i = 0; i < batchSize && bondIndex < chainABonds.length; i++, bondIndex++) {
                const [fromAtomId, bonds] = chainABonds[bondIndex];

                const fromAtom = this.atomLookup[fromAtomId];

                bonds.forEach(bond => {
                    const toAtomId = bond.to;
                    const toAtom = this.atomLookup[toAtomId];

                    // Skip if bond is NOT between two atoms in Chain A
                    if (!fromAtom || !toAtom || !chainAatoms.includes(toAtomId)) return;

                    const [x1, y1, z1] = fromAtom.position;
                    const [x2, y2, z2] = toAtom.position;

                    const midX = (x1 + x2) / 2;
                    const midY = (y1 + y2) / 2;
                    const midZ = (z1 + z2) / 2;

                    const bondDistance = bond.distance;

                    // Calculate rotation
                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    const dz = z2 - z1;
                    const computedDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    const phi = Math.atan2(dy, dx) * (180 / Math.PI);
                    const theta = Math.acos(dz / bondDistance) * (180 / Math.PI);

                    const AtomBond = document.createElement('a-cylinder');
                    AtomBond.setAttribute("id", `bond-${fromAtomId}-${bond.to}`); // assign unique ID 
                    AtomBond.setAttribute('position', `${midX * scale} ${midY * scale} ${midZ * scale}`);
                    AtomBond.setAttribute('height', bondDistance * scale);
                    AtomBond.setAttribute('rotation', `${theta} ${phi} 0`);
                    AtomBond.setAttribute('radius', 0.05 * scale);
                    AtomBond.setAttribute('color', '#CCCCCC');
                    AtomBond.setAttribute("visible", true);

                    fragmentBonds.appendChild(AtomBond);
                });
            }

            // Append batch of bonds
            this.proteinContainer.appendChild(fragmentBonds);

            if (bondIndex < chainABonds.length) {
                requestAnimationFrame(renderBonds); // Continue rendering next batch
            } else {
                this.displayLoadingIndicator(false); // Hide loading indicator
            }
        };

        requestAnimationFrame(renderBonds); // Start bond rendering


    },

    renderChainB: function(scale) {
        //Error Handeling
        if (!this.chainsLookup || !this.atomLookup) {
            console.error("Error: atomLookup or chainLookup is not initialized or is empty.");
            return;
        }

        // Ensure Chain B exists in chainsLookup
        if (!this.chainsLookup["B"]) {
            console.error("Error: Chain A is not found in chainsLookup.");
            return;
        }

        // Batch append atoms
        const fragment = document.createDocumentFragment(); 

        // Get all atom IDs in Chain B
        let chainBatoms = this.chainsLookup["B"];  

        console.log("Chain B Atoms:", chainBatoms);
        console.log("Connections Keys:", Object.keys(this.connections).map(Number));  // Convert to numbers

        // Loop over atoms in chain B 
        chainBatoms.forEach(atomId => {
            let atom = this.atomLookup[atomId];  // Retrieve atom details
    
            if (!atom) return;  // Skip missing atoms
    
            const [x, y, z] = atom.position;
            const color = this.getAtomColor(atom.element);
    
            if (!color) {
                console.error(`Invalid color for atom type: ${atom.element}`);
                return;
            }
    
            const sphere = document.createElement('a-sphere');
            sphere.setAttribute("id", `atom-${atomId}`);
            sphere.setAttribute('position', `${x * scale} ${y * scale} ${z * scale}`);
            sphere.setAttribute('radius', this.getAtomRadius(atom.element) * scale);
            sphere.setAttribute('color', color);
            sphere.setAttribute('metalness', '0.2');
            sphere.setAttribute('roughness', '0.3');
            sphere.setAttribute("visible", true);
    
            // Add to fragment (batch for performance)
            fragment.appendChild(sphere);
        });

        // Append all atoms at once
        this.proteinContainer.appendChild(fragment);


        // Render Bonds 
        // Use requestAnimationFrame to distribute bond rendering over time
        let bondArray = Object.entries(this.connections);
        let bondIndex = 0;

        // Filter only the bonds between atoms in Chain A
        let chainBBonds = bondArray.filter(([fromAtomId, bonds]) => {
            // Convert ID key from string to number
            const atomId = Number(fromAtomId); 
            return chainBatoms.includes(atomId) && 
                   bonds.some(bond => chainBatoms.includes(bond.to));
        });

        console.log("Filtered Chain B Bonds:", chainBBonds);

        const renderBonds = () => {
            //Show Loading Indicator
            this.displayLoadingIndicator(true);
            const fragmentBonds = document.createDocumentFragment();
            let batchSize = 50; // Render 50 bonds per frame to avoid freezing

            for (let i = 0; i < batchSize && bondIndex < chainBBonds.length; i++, bondIndex++) {
                const [fromAtomId, bonds] = chainBBonds[bondIndex];

                const fromAtom = this.atomLookup[fromAtomId];

                bonds.forEach(bond => {
                    const toAtomId = bond.to;
                    const toAtom = this.atomLookup[toAtomId];

                    // Skip if bond is NOT between two atoms in Chain A
                    if (!fromAtom || !toAtom || !chainBatoms.includes(toAtomId)) return;

                    const [x1, y1, z1] = fromAtom.position;
                    const [x2, y2, z2] = toAtom.position;

                    const midX = (x1 + x2) / 2;
                    const midY = (y1 + y2) / 2;
                    const midZ = (z1 + z2) / 2;

                    const bondDistance = bond.distance;

                    // Calculate rotation
                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    const dz = z2 - z1;
                    const computedDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    const phi = Math.atan2(dy, dx) * (180 / Math.PI);
                    const theta = Math.acos(dz / bondDistance) * (180 / Math.PI);

                    const AtomBond = document.createElement('a-cylinder');
                    AtomBond.setAttribute("id", `bond-${fromAtomId}-${bond.to}`); // assign unique ID 
                    AtomBond.setAttribute('position', `${midX * scale} ${midY * scale} ${midZ * scale}`);
                    AtomBond.setAttribute('height', bondDistance * scale);
                    AtomBond.setAttribute('rotation', `${theta} ${phi} 0`);
                    AtomBond.setAttribute('radius', 0.05 * scale);
                    AtomBond.setAttribute('color', '#CCCCCC');
                    AtomBond.setAttribute("visible", true);

                    fragmentBonds.appendChild(AtomBond);
                });
            }

            // Append batch of bonds
            this.proteinContainer.appendChild(fragmentBonds);

            if (bondIndex < chainBBonds.length) {
                requestAnimationFrame(renderBonds); // Continue rendering next batch
            } else {
                this.displayLoadingIndicator(false); // Hide loading indicator
            }
        };

        requestAnimationFrame(renderBonds); // Start bond rendering


    },

    renderChainC: function(scale) {
        //Error Handeling
        if (!this.chainsLookup || !this.atomLookup) {
            console.error("Error: atomLookup or chainLookup is not initialized or is empty.");
            return;
        }

        // Ensure Chain C exists in chainsLookup
        if (!this.chainsLookup["C"]) {
            console.error("Error: Chain C is not found in chainsLookup.");
            return;
        }

        // Batch append atoms
        const fragment = document.createDocumentFragment(); 

        // Get all atom IDs in Chain C
        let chainCatoms = this.chainsLookup["C"];  

        console.log("Chain C Atoms:", chainCatoms);
        console.log("Connections Keys:", Object.keys(this.connections).map(Number));  // Convert to numbers

        // Loop over atoms in chain C
        chainCatoms.forEach(atomId => {
            let atom = this.atomLookup[atomId];  // Retrieve atom details
    
            if (!atom) return;  // Skip missing atoms
    
            const [x, y, z] = atom.position;
            const color = this.getAtomColor(atom.element);
    
            if (!color) {
                console.error(`Invalid color for atom type: ${atom.element}`);
                return;
            }
    
            const sphere = document.createElement('a-sphere');
            sphere.setAttribute("id", `atom-${atomId}`);
            sphere.setAttribute('position', `${x * scale} ${y * scale} ${z * scale}`);
            sphere.setAttribute('radius', this.getAtomRadius(atom.element) * scale);
            sphere.setAttribute('color', color);
            sphere.setAttribute('metalness', '0.2');
            sphere.setAttribute('roughness', '0.3');
            sphere.setAttribute("visible", true);
    
            // Add to fragment (batch for performance)
            fragment.appendChild(sphere);
        });

        // Append all atoms at once
        this.proteinContainer.appendChild(fragment);


        // Render Bonds 
        // Use requestAnimationFrame to distribute bond rendering over time
        let bondArray = Object.entries(this.connections);
        let bondIndex = 0;

        // Filter only the bonds between atoms in Chain A
        let chainCBonds = bondArray.filter(([fromAtomId, bonds]) => {
            // Convert ID key from string to number
            const atomId = Number(fromAtomId); 
            return chainCatoms.includes(atomId) && 
                   bonds.some(bond => chainCatoms.includes(bond.to));
        });

        console.log("Filtered Chain C Bonds:", chainCBonds);

        const renderBonds = () => {
            //Show Loading Indicator
            this.displayLoadingIndicator(true);
            const fragmentBonds = document.createDocumentFragment();
            let batchSize = 50; // Render 50 bonds per frame to avoid freezing

            for (let i = 0; i < batchSize && bondIndex < chainCBonds.length; i++, bondIndex++) {
                const [fromAtomId, bonds] = chainCBonds[bondIndex];

                const fromAtom = this.atomLookup[fromAtomId];

                bonds.forEach(bond => {
                    const toAtomId = bond.to;
                    const toAtom = this.atomLookup[toAtomId];

                    // Skip if bond is NOT between two atoms in Chain A
                    if (!fromAtom || !toAtom || !chainCatoms.includes(toAtomId)) return;

                    const [x1, y1, z1] = fromAtom.position;
                    const [x2, y2, z2] = toAtom.position;

                    const midX = (x1 + x2) / 2;
                    const midY = (y1 + y2) / 2;
                    const midZ = (z1 + z2) / 2;

                    const bondDistance = bond.distance;

                    // Calculate rotation
                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    const dz = z2 - z1;
                    const computedDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    const phi = Math.atan2(dy, dx) * (180 / Math.PI);
                    const theta = Math.acos(dz / bondDistance) * (180 / Math.PI);

                    const AtomBond = document.createElement('a-cylinder');
                    AtomBond.setAttribute("id", `bond-${fromAtomId}-${bond.to}`); // assign unique ID 
                    AtomBond.setAttribute('position', `${midX * scale} ${midY * scale} ${midZ * scale}`);
                    AtomBond.setAttribute('height', bondDistance * scale);
                    AtomBond.setAttribute('rotation', `${theta} ${phi} 0`);
                    AtomBond.setAttribute('radius', 0.05 * scale);
                    AtomBond.setAttribute('color', '#CCCCCC');
                    AtomBond.setAttribute("visible", true);

                    fragmentBonds.appendChild(AtomBond);
                });
            }

            // Append batch of bonds
            this.proteinContainer.appendChild(fragmentBonds);

            if (bondIndex < chainCBonds.length) {
                requestAnimationFrame(renderBonds); // Continue rendering next batch
            } else {
                this.displayLoadingIndicator(false); // Hide loading indicator
            }
        };

        requestAnimationFrame(renderBonds); // Start bond rendering


    },

    renderChainD: function(scale) {
        //Error Handeling
        if (!this.chainsLookup || !this.atomLookup) {
            console.error("Error: atomLookup or chainLookup is not initialized or is empty.");
            return;
        }

        // Ensure Chain C exists in chainsLookup
        if (!this.chainsLookup["D"]) {
            console.error("Error: Chain D is not found in chainsLookup.");
            return;
        }

        // Batch append atoms
        const fragment = document.createDocumentFragment(); 

        // Get all atom IDs in Chain C
        let chainDatoms = this.chainsLookup["D"];  

        console.log("Chain C Atoms:", chainDatoms);
        console.log("Connections Keys:", Object.keys(this.connections).map(Number));  // Convert to numbers

        // Loop over atoms in chain C
        chainDatoms.forEach(atomId => {
            let atom = this.atomLookup[atomId];  // Retrieve atom details
    
            if (!atom) return;  // Skip missing atoms
    
            const [x, y, z] = atom.position;
            const color = this.getAtomColor(atom.element);
    
            if (!color) {
                console.error(`Invalid color for atom type: ${atom.element}`);
                return;
            }
    
            const sphere = document.createElement('a-sphere');
            sphere.setAttribute("id", `atom-${atomId}`);
            sphere.setAttribute('position', `${x * scale} ${y * scale} ${z * scale}`);
            sphere.setAttribute('radius', this.getAtomRadius(atom.element) * scale);
            sphere.setAttribute('color', color);
            sphere.setAttribute('metalness', '0.2');
            sphere.setAttribute('roughness', '0.3');
            sphere.setAttribute("visible", true);
    
            // Add to fragment (batch for performance)
            fragment.appendChild(sphere);
        });

        // Append all atoms at once
        this.proteinContainer.appendChild(fragment);


        // Render Bonds 
        // Use requestAnimationFrame to distribute bond rendering over time
        let bondArray = Object.entries(this.connections);
        let bondIndex = 0;

        // Filter only the bonds between atoms in Chain A
        let chainDBonds = bondArray.filter(([fromAtomId, bonds]) => {
            // Convert ID key from string to number
            const atomId = Number(fromAtomId); 
            return chainDatoms.includes(atomId) && 
                   bonds.some(bond => chainDatoms.includes(bond.to));
        });

        console.log("Filtered Chain C Bonds:", chainDBonds);

        const renderBonds = () => {
            //Show Loading Indicator
            this.displayLoadingIndicator(true);
            const fragmentBonds = document.createDocumentFragment();
            let batchSize = 50; // Render 50 bonds per frame to avoid freezing

            for (let i = 0; i < batchSize && bondIndex < chainDBonds.length; i++, bondIndex++) {
                const [fromAtomId, bonds] = chainDBonds[bondIndex];

                const fromAtom = this.atomLookup[fromAtomId];

                bonds.forEach(bond => {
                    const toAtomId = bond.to;
                    const toAtom = this.atomLookup[toAtomId];

                    // Skip if bond is NOT between two atoms in Chain A
                    if (!fromAtom || !toAtom || !chainDatoms.includes(toAtomId)) return;

                    const [x1, y1, z1] = fromAtom.position;
                    const [x2, y2, z2] = toAtom.position;

                    const midX = (x1 + x2) / 2;
                    const midY = (y1 + y2) / 2;
                    const midZ = (z1 + z2) / 2;

                    const bondDistance = bond.distance;

                    // Calculate rotation
                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    const dz = z2 - z1;
                    const computedDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    const phi = Math.atan2(dy, dx) * (180 / Math.PI);
                    const theta = Math.acos(dz / bondDistance) * (180 / Math.PI);

                    const AtomBond = document.createElement('a-cylinder');
                    AtomBond.setAttribute("id", `bond-${fromAtomId}-${bond.to}`); // assign unique ID 
                    AtomBond.setAttribute('position', `${midX * scale} ${midY * scale} ${midZ * scale}`);
                    AtomBond.setAttribute('height', bondDistance * scale);
                    AtomBond.setAttribute('rotation', `${theta} ${phi} 0`);
                    AtomBond.setAttribute('radius', 0.05 * scale);
                    AtomBond.setAttribute('color', '#CCCCCC');
                    AtomBond.setAttribute("visible", true);

                    fragmentBonds.appendChild(AtomBond);
                });
            }

            // Append batch of bonds
            this.proteinContainer.appendChild(fragmentBonds);

            if (bondIndex < chainDBonds.length) {
                requestAnimationFrame(renderBonds); // Continue rendering next batch
            } else {
                this.displayLoadingIndicator(false); // Hide loading indicator
            }
        };

        requestAnimationFrame(renderBonds); // Start bond rendering


    },


    // Get color for an atom based on its element
    getAtomColor: function(element) {
        if (!element) return '#AAAAAA';
        const normalizedElement = element.toUpperCase();
        return atomColors[normalizedElement] || '#AAAAAA';
    },

    // Get radius for an atom based on its element
    getAtomRadius: function (element, mode = 'default') {
        if (!element) return atomRadii.default;
        const normalizedElement = element.toUpperCase();
        if (mode === 'space-filling') {
        return spaceFillingRadii[normalizedElement] || spaceFillingRadii.default;
        }
        return atomRadii[normalizedElement] || atomRadii.default;
    }, 

    // count how many times specefic atom shows up for legend 
    countAtoms: function(displayedAtoms = null){
        let atomCounts = {}

        // If displayedAtoms is null, count all atoms otherwise, filter based on the displayed ones
        let atomsToCount = displayedAtoms ? displayedAtoms.map(atomId => this.atomLookup[atomId]) : Object.values(this.atomLookup);

        atomsToCount.forEach(atom => {
            // cast to upper case to ensure they are all in the same case for comparison
            const element = atom.element.toUpperCase();

            // if its not already in the atoms count dictionary add it 
            if(!atomCounts[element]){
                atomCounts[element] = {count: 0, color: this.getAtomColor(element)};
            }

            // otherwise increase count of that atom 
            atomCounts[element].count++;

        })

        console.log(atomCounts);

        return atomCounts

    }, 

    displayTitle: function(displayMode){

        // Remove any existing title before adding a new one
        let existingTitle = document.getElementById("viz-title");
        if (existingTitle) existingTitle.parentNode.removeChild(existingTitle);

        // Title Position 
        let titleX = 2.5;
        let titleY = 11;
        let titleZ = 5;

         // Create the title text
        let titleText = document.createElement('a-text');
        titleText.setAttribute('id', 'viz-title');
        titleText.setAttribute('position', `${titleX} ${titleY} ${titleZ}`);
        titleText.setAttribute('color', '#FFFFFF'); // White text
        titleText.setAttribute('align', 'center');
        titleText.setAttribute('scale', '1.5 1.5 1.5');

        // Set text based on display mode
        let modeTitle = "";
        switch (displayMode) {
            case 'ball-stick':
                modeTitle = "DEOXYHEMOGLOBIN Ball & Stick Model";
                break;
            case 'space-filling':
                modeTitle = "DEOXYHEMOGLOBIN Space Filling Model";
                break;
            case 'chain-A':
                modeTitle = "DEOXYHEMOGLOBIN Chain A";
                break;
            case 'chain-B':
                modeTitle = "DEOXYHEMOGLOBIN Chain B";
                break;
            case 'chain-C':
                modeTitle = "DEOXYHEMOGLOBIN Chain C";
                break;
            case 'chain-D':
                modeTitle = "DEOXYHEMOGLOBIN Chain D";
                break;
            default:
                modeTitle = "DEOXYHEMOGLOBIN";
                break;
        }

        titleText.setAttribute('value', modeTitle);
        
        // Append to scene
        this.el.appendChild(titleText);
    }, 

    // Add view control buttons to switch between visualizations
    addViewControls: function() {
        const controls = document.createElement('a-entity');
        // Position the controls to the RIGHT of the protein visualization
        controls.setAttribute('position', '18 3 8');

        // Use Set to ensure unique residue values
        const residueTypes = new Set(); 
        // Collect unique residue types
        Object.values(this.componentsData).forEach(details => residueTypes.add(details.type));
        // Convert Set to an array
        const residueTypeList = Array.from(residueTypes);
        console.log('residueTypeList',residueTypeList);


        //Residue Drop Down Menu HTML 
        // Select the dropdown from the DOM
        const dropdown = document.getElementById('residueDropdown');
        // Error Handeling
        if (!dropdown) {
            console.error("Dropdown element not found in the DOM.");
            return;
        }

        // Clear previous options 
        dropdown.innerHTML = '<option value="">Select a Residue</option>';

        // Populate dropdown with residue types
        residueTypeList.forEach(type => {
            let option = document.createElement("option");
            option.value = type;
            option.textContent = type;
            dropdown.appendChild(option);
        });

        // Attach event listener to dropdown
        dropdown.addEventListener('change', (event) => {
            const selectedResidue = event.target.value;
            if (selectedResidue) {
                this.displayResidue(selectedResidue);
            }
        });


        // Add Title Above Buttons
        const header = document.createElement('a-text');
        header.setAttribute('value', 'Highlight Components'); // Title text
        header.setAttribute('position', '2.8 1 0'); // Position it above buttons
        header.setAttribute('align', 'center');
        header.setAttribute('color', 'white');
        header.setAttribute('width', '3'); // Make text larger
        controls.appendChild(header); // Add title to the controls

        // Layout in rows of 5
        const columns = 5; // Number of buttons per row
        const spacingX = 1.5; // Horizontal spacing between buttons
        const spacingY = -0.7; // Vertical spacing between rows



        residueTypeList.forEach((type, index) => {

            // CHAT GPT: Calculate row and column positions
            const row = Math.floor(index / columns); // Determines which row
            const col = index % columns; // Determines which column

            // Get residue color
            const color = residueColors[type] || residueColors['default'];
            const button = document.createElement('a-box');

            // Position buttons in a grid (5 per row)
            const xOffset = col * spacingX; // Spread out horizontally
            const yOffset = row * spacingY; // Move down for each new row
            button.setAttribute('position', `${xOffset} ${yOffset} 0`);

            button.setAttribute('width', '1');
            button.setAttribute('height', '0.5');
            button.setAttribute('depth', '0.1');
            button.setAttribute('color', color);
            button.setAttribute('class', 'clickable');

            // create residue type label
            const label = document.createElement('a-text');
            label.setAttribute('value', type);
            label.setAttribute('position', '0 0 0.06');
            label.setAttribute('align', 'center');
            label.setAttribute('color', 'white');
            label.setAttribute('width', '2');
            button.appendChild(label);
        
            
            // Attach event listener to highlight residues on click
            button.addEventListener('click', () => {
                console.log(`Clicked on: ${type}`); // Debugging
                this.highlightResidueType(type);
            });

            controls.appendChild(button); // Add button to control panel
        });
        
        this.el.sceneEl.appendChild(controls);
    },

    // Function to highlight residues of a selected type
    highlightResidueType: function(residueType) {

        // Error Handeling
        if (!this.componentsData) {
            console.error("Error: No component data available.");
            return;
        }

        // Reset colors if another component was previously selected
        this.resetResidueColors();
    
        // Loop through componentsData to find residues of the selected type
        Object.values(this.componentsData).forEach(residue => {
            if (residue.type === residueType) { // Match selected type
                console.log("residue.type", residue.type);
                console.log("residueType", residueType);
                residue.atoms.forEach(atom => {
                    const atomEl = document.getElementById(`atom-${atom}`);
                    if (atomEl) {
                        atomEl.setAttribute("color", residueColors[residueType] || "#CCCCCC");
                    }
                });
            }
        });

        
    },

    resetResidueColors: function () {
        Object.entries(this.atomLookup).forEach(([atomId, atom]) => { 
            const atomEl = document.getElementById(`atom-${atomId}`);
            if (atomEl) {
                atomEl.setAttribute('color', this.getAtomColor(atom.element));
            }
        });
        console.log("Reset component colors to default.");
    }, 

    displayResidue: function(residueType){
        // Error Handeling 
        if (!this.componentsData || !this.connections || !this.atomLookup) {
            console.error("Error: Missing component, connections, or atom lookup data.");
            return;
        }
    
    
        const atomsToShow = new Set(); 
        const bondsToShow = [];


        Object.entries(this.componentsData).forEach(([residueId, residue]) => {
            if (residue.type === residueType) {
                console.log(`Residue: ${residueId} | Type: ${residue.type} | Atoms: ${residue.atoms}`);
                
                // Store atoms that should be visible
                residue.atoms.forEach(atom => atomsToShow.add(atom)); 
            }
        });

        // Hide all atoms first (ensures only selected residue atoms are visible)
        Object.keys(this.atomLookup).forEach(atomId => {
            const atomEl = document.getElementById(`atom-${atomId}`);
            if (atomEl) {
                atomEl.setAttribute("visible", false); // Hide all atoms
            }
        });
    

        // Show only atoms in the selected residue
        atomsToShow.forEach(atomId => {
            const atomEl = document.getElementById(`atom-${atomId}`);
            if (atomEl) {
                atomEl.setAttribute("visible", true); 
            }
        });

        // Hide all bonds before rendering new ones
        this.hideAllBonds();

        
         //Filter bonds that connect only atoms within the selected residue**
        Object.entries(this.connections).forEach(([fromAtomId, bonds]) => {
            if (atomsToShow.has(parseInt(fromAtomId))) {
                bonds.forEach(bond => {
                    if (atomsToShow.has(bond.to)) {
                        bondsToShow.push({ from: fromAtomId, to: bond.to, distance: bond.distance });
                    }
                });
            }
        });

        // Show only bonds that connect atoms within the residue
        Object.entries(this.connections).forEach(([fromAtomId, bonds]) => {
            if (atomsToShow.has(parseInt(fromAtomId))) {
                bonds.forEach(bond => {
                    if (atomsToShow.has(bond.to)) {
                        const bondId = `bond-${fromAtomId}-${bond.to}`;
                        const bondEl = document.getElementById(bondId);
                        if (bondEl) {
                            bondEl.setAttribute("visible", true); 
                        }
                    }
                });
            }
        });

        console.log("Only showing atoms for residue:", residueType);

    }, 

    hideAllBonds: function() {
        document.querySelectorAll("[id^='bond-']").forEach(bondEl => {
            bondEl.setAttribute("visible", false); // Hide instead of remove
        });
        console.log("All bonds are now hidden.");
    },

    displayLoadingIndicator: function(visible) {
        const loadingIndicator = document.getElementById("loading-indicator");

        if (!loadingIndicator) {
            console.error("Loading indicator not found in HTML.");
            return;
        }
    
        if (visible) {
            loadingIndicator.style.display = "block";  // Show loading
        } else {
            loadingIndicator.style.display = "none";  // Hide loading
        }
    }
    
});

// Atom colors based on element type (CPK coloring scheme)
const atomColors = {
    'H': '#FFFFFF', // White
    'C': '#909090', // Light grey
    'N': '#3050F8', // Blue
    'O': '#FF0D0D', // Red
    'P': '#FF8000', // Orange
    'S': '#FFFF30', // Yellow
    'CL': '#1FF01F', // Green
    'F': '#90E050', // Light green
    'BR': '#A62929', // Brown
    'I': '#940094', // Purple
    'HE': '#D9FFFF',
    'NE': '#B3E3F5',
    'AR': '#80D1E3',
    'XE': '#940094',
    'FE': '#E06633', // Orange-brown for iron
    'CA': '#7D80B0', // Light purple for calcium
    'ZN': '#7D80B0', // Light purple for zinc
    'MG': '#8AFF00' // Light green for magnesium
};

// RasMol/Shapely Amino Acid Color Scheme
const residueColors = {
    'ALA': '#8CFF8C', // Alanine - Light Green
    'ARG': '#00007C', // Arginine - Dark Blue
    'ASN': '#FF7C70', // Asparagine - Pink
    'ASP': '#A00042', // Aspartic Acid - Dark Red
    'CYS': '#FFFF70', // Cysteine - Yellow
    'GLN': '#FF4C4C', // Glutamine - Red
    'GLU': '#660000', // Glutamic Acid - Darker Red
    'GLY': '#EEEEEE', // Glycine - Light Gray
    'HIS': '#7070FF', // Histidine - Medium Blue
    'ILE': '#004C00', // Isoleucine - Dark Green
    'LEU': '#455E45', // Leucine - Olive Green
    'LYS': '#4747B8', // Lysine - Blue
    'MET': '#B8A042', // Methionine - Sulfur Yellow
    'PHE': '#534C52', // Phenylalanine - Grayish Brown
    'PRO': '#525252', // Proline - Dark Gray
    'SER': '#FF7070', // Serine - Light Red
    'THR': '#B84C00', // Threonine - Brownish Orange
    'TRP': '#4F4600', // Tryptophan - Dark Brown
    'TYR': '#8C704C', // Tyrosine - Yellowish Brown
    'VAL': '#FF8CFF', // Valine - Light Purple
    'default': '#CCCCCC' // Default Gray
};

// Default atom radius values (in Angstroms)
const atomRadii = {
    'H': 0.25,
    'C': 0.7,
    'N': 0.65,
    'O': 0.6,
    'P': 1.0,
    'S': 1.0,
    'CL': 1.0,
    'F': 0.5,
    'BR': 1.15,
    'I': 1.4,
    'default': 0.8
};

// Space filling radii (van der Waals radii)
const spaceFillingRadii = {
    'H': 1.2,
    'C': 1.7,
    'N': 1.55,
    'O': 1.52,
    'P': 1.8,
    'S': 1.8,
    'CL': 1.75,
    'F': 1.47,
    'BR': 1.85,
    'I': 1.98,
    'default': 1.5
};

AFRAME.registerComponent('structure-handler', {
    schema: {
        selectionMode: {type: 'string', default: 'element'},
        measurementType: {type: 'string'} ,
        infoDisplay:{type: 'boolean', default: true}
    },

    init: function() {

        console.log("Waiting for protein-visualization event...");

        this.el.sceneEl.addEventListener("protein-visualization-ready", () => {
            console.log("Received protein-visualization-ready event!");
            
            this.proteinVisualization = document.querySelector('[protein-visualization]')?.components['protein-visualization'];
            
            if (this.proteinVisualization) {
                console.log("Protein visualization component found via event!");
                console.log("Checking protein_bound_max inside structure-handler:", this.proteinVisualization.protein_bound_max);
                
                this.setupTools();
                this.createUI();
                this.addEventListeners();
            } else {
                console.error("Protein visualization component still not found!");
            }
        });
    },

    setupTools: function(){

    },

    createUI: function(){

        // Ensure the protein visualization component is available
        if (!this.proteinVisualization) {
            console.error("Protein visualization component not found in createUI");
            return;
        }

        // Toggle to Ball & Stick view
        document.getElementById('view-ball-stick').addEventListener('click', () => {
            this.proteinVisualization.el.setAttribute('protein-visualization', 'displayMode', 'ball-stick');
            this.proteinVisualization.createVisualisation();
        });

        // Toggle to Space Filling view
        document.getElementById('view-space-filling').addEventListener('click', () => {
            this.proteinVisualization.el.setAttribute('protein-visualization', 'displayMode', 'space-filling');
            this.proteinVisualization.createVisualisation();
        });

        // Toggle to chain A  view
        document.getElementById('view-chainA').addEventListener('click', () => {
            this.proteinVisualization.el.setAttribute('protein-visualization', 'displayMode', 'chain-A');
            this.proteinVisualization.createVisualisation();
        });

        // Toggle to chain B  view
        document.getElementById('view-chainB').addEventListener('click', () => {
            this.proteinVisualization.el.setAttribute('protein-visualization', 'displayMode', 'chain-B');
            this.proteinVisualization.createVisualisation();
        });

        // Toggle to chain C  view
        document.getElementById('view-chainC').addEventListener('click', () => {
            this.proteinVisualization.el.setAttribute('protein-visualization', 'displayMode', 'chain-C');
            this.proteinVisualization.createVisualisation();
        });

        // Toggle to chain D  view
        document.getElementById('view-chainD').addEventListener('click', () => {
            this.proteinVisualization.el.setAttribute('protein-visualization', 'displayMode', 'chain-D');
            this.proteinVisualization.createVisualisation();
        });




    },


    addEventListeners: function(){

        

    }

  

  
});